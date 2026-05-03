/**
 * Webhook Server — HTTP entrypoint for CodeNexus control-plane.
 *
 * Handles GitHub webhook ingestion, session orchestration via the orchestrator,
 * and run status queries. Can run standalone (Express/Hono) or as a
 * Cloudflare Workers entrypoint.
 */

import { createHono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import type { GitHubWebhookEvent } from '../../shared/src/types';
import type { OrchestrationRun } from './orchestrator';
import { Orchestrator } from './orchestrator';
import { loadConfig, getConfig, ConfigurationError } from './config';
import { SessionManager } from './session-manager';
import { createSign } from 'node:crypto';

const app = new createHono();

const VERSION = '0.2.0';

function createWebhookSignature(body: string, secret: string): string {
  return createSign('SHA256', secret).update(body, 'utf8').digest('hex');
}

async function verifyGitHubWebhook(
  body: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;

  const expected = `sha256=${createWebhookSignature(body, secret)}`;
  return signature === expected;
}

function parseGitHubEvent(eventHeader: string | undefined): string {
  return eventHeader ?? 'unknown';
}

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', async (c) => {
  try {
    getConfig();
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false, reason: 'config not loaded' }, 503);
  }
});

app.post('/webhook/github', async (c) => {
  const bodyRaw = await c.req.text();

  const eventName = c.req.header('X-GitHub-Event') ?? 'unknown';
  const delivery = c.req.header('X-GitHub-Delivery');
  const signature = c.req.header('X-Hub-Signature-256');

  console.log(`[webhook] Received ${eventName} event (delivery: ${delivery})`);

  let webhookSecret: string;
  try {
    webhookSecret = getConfig().github.webhookSecret;
  } catch {
    return c.json({ error: 'config not loaded, call /ready first' }, 503);
  }

  const isValid = await verifyGitHubWebhook(bodyRaw, signature, webhookSecret);
  if (!isValid) {
    console.warn('[webhook] Invalid signature');
    return c.json({ error: 'invalid signature' }, 401);
  }

  if (eventName !== 'pull_request') {
    console.log(`[webhook] Ignoring non-PR event: ${eventName}`);
    return c.json({ ok: true, event: eventName, processed: false });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyRaw);
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const prEvent = payload as {
    action?: string;
    number?: number;
    pull_request?: GitHubWebhookEvent['pullRequest'];
    repository?: GitHubWebhookEvent['repository'];
    sender?: { login: string };
  };

  const pr = prEvent.pull_request;
  const repo = prEvent.repository;

  if (!pr || !repo) {
    return c.json({ error: 'missing pull_request or repository' }, 400);
  }

  const skipActions = ['closed', 'synchronize'];
  if (prEvent.action && !skipActions.includes(prEvent.action)) {
    console.log(`[webhook] Skipping action: ${prEvent.action}`);
    return c.json({ ok: true, action: prEvent.action, processed: false });
  }

  const webhookEvent: GitHubWebhookEvent = {
    action: prEvent.action ?? 'opened',
    pullRequest: {
      number: pr.number ?? 0,
      state: pr.state ?? 'open',
      title: pr.title ?? '',
      body: pr.body ?? '',
      head: {
        ref: pr.head?.ref ?? '',
        sha: pr.head?.sha ?? '',
      },
      base: {
        ref: pr.base?.ref ?? '',
        sha: pr.base?.sha ?? '',
      },
      user: {
        login: pr.user?.login ?? '',
      },
    },
    repository: {
      fullName: repo.full_name ?? '',
      owner: {
        login: repo.owner?.login ?? '',
      },
      name: repo.name ?? '',
      cloneUrl: repo.clone_url ?? '',
    },
    sender: {
      login: prEvent.sender?.login ?? '',
    },
  };

  const sessionId = crypto.randomUUID();
  console.log(
    `[webhook] Starting review for ${repo.full_name}/pull/${pr.number} (session: ${sessionId})`,
  );

  try {
    const orchestrator = new Orchestrator();
    const run = await orchestrator.executeCycle({
      event: webhookEvent,
      sessionId,
    });

    console.log(
      `[webhook] Review complete: ${run.id} (status: ${run.overallStatus})`,
    );

    return c.json({
      ok: true,
      runId: run.id,
      sessionId,
      status: run.overallStatus,
      commentLength: run.prCommentBody.length,
    });
  } catch (error) {
    console.error('[webhook] Orchestration failed:', error);
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

app.get('/runs', (c) => {
  const orchestrator = new Orchestrator();
  const runs = orchestrator.getActiveRuns();
  return c.json({
    count: runs.length,
    runs: runs.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      status: r.overallStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    })),
  });
});

app.get('/runs/:id', async (c) => {
  const runId = c.req.param('id');
  const orchestrator = new Orchestrator();
  const run = orchestrator.getRun(runId);

  if (!run) {
    return c.json({ error: 'run not found' }, 404);
  }

  return c.json({
    id: run.id,
    sessionId: run.sessionId,
    status: run.overallStatus,
    mode: run.mode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    commentLength: run.prCommentBody.length,
    results: run.results.map((r) => ({
      step: r.step,
      status: r.status,
      durationMs: r.durationMs,
      error: r.error,
    })),
    commentPreview: run.prCommentBody.slice(0, 500),
  });
});

export default app;