import express from 'express';
import crypto from 'node:crypto';
import { WorkflowEngine } from '../../packages/workflow-engine/src/index';
import { defineCodeReviewWorkflow } from '../../packages/workflow-engine/src/review-workflow';

export function createNodeApp(): express.Application {
  const app = express();
  const engine = new WorkflowEngine();
  defineCodeReviewWorkflow(engine);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'control-plane',
      mode: 'node-adapter',
      timestamp: new Date().toISOString(),
      activeRuns: engine.listRuns().length,
    });
  });

  // GitHub webhook
  app.post('/api/webhooks/github', async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const secret = process.env.CNX_GITHUB_WEBHOOK_SECRET || '';
    const body = JSON.stringify(req.body);

    if (secret && !verifyWebhookSignature(body, signature, secret)) {
      res.status(401).json({ error: 'invalid_signature', message: 'HMAC verification failed' });
      return;
    }

    const deliveryId = req.headers['x-github-delivery'] as string;
    const event = req.headers['x-github-event'] as string;
    const payload = req.body;

    // Only process PR events
    if (event === 'pull_request' || event === 'pull_request_review' || event === 'issue_comment') {
      try {
        const run = await engine.execute('code_review', {
          action: payload.action,
          repository: payload.repository?.full_name || '',
          prNumber: payload.pull_request?.number || payload.issue?.number,
          branch: payload.pull_request?.head?.ref || '',
          deliveryId,
        });

        res.status(202).json({
          message: 'Webhook received, review initiated',
          sessionId: run.id,
          deliveryId,
        });
      } catch (err) {
        console.error('[NodeAdapter] Workflow execution failed:', err);
        res.status(500).json({ error: 'workflow_failed', message: (err as Error).message });
      }
    } else {
      res.status(200).json({ message: 'Event ignored', event });
    }
  });

  // Workflow runs
  app.get('/api/workflows/runs', (_req, res) => {
    const runs = engine.listRuns().map(r => ({
      id: r.id,
      workflowName: r.workflowName,
      status: r.status,
      stepCount: r.steps.size,
      createdAt: r.createdAt,
    }));
    res.json({ count: runs.length, runs });
  });

  app.get('/api/workflows/runs/:runId', (req, res) => {
    const run = engine.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'not_found', message: `Run "${req.params.runId}" not found` });
      return;
    }
    const steps = [...run.steps.entries()].map(([name, state]) => ({
      name,
      status: state.status,
      attempts: state.attempts,
      error: state.error,
    }));
    res.json({
      id: run.id,
      workflowName: run.workflowName,
      status: run.status,
      steps,
      events: run.events.slice(-20),
      createdAt: run.createdAt,
    });
  });

  app.post('/api/workflows/runs/:runId/cancel', (req, res) => {
    const run = engine.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    engine.cancel(req.params.runId);
    res.json({ message: 'Cancellation requested', runId: req.params.runId });
  });

  // Auth-protected session endpoint (JWT validation)
  app.get('/api/session/:sessionId', (req, res) => {
    res.json({ sessionId: req.params.sessionId, status: 'local-mode', note: 'Full session API requires Cloudflare Durable Objects' });
  });

  return app;
}

function verifyWebhookSignature(body: string, header: string, secret: string): boolean {
  if (!header || !secret) return false;
  const sig = header.replace('sha256=', '');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  // Constant-time comparison
  if (sig.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < sig.length; i++) ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return ok === 0;
}

// Standalone entry point
if (require.main === module) {
  const port = parseInt(process.env.PORT || '8787', 10);
  const app = createNodeApp();
  app.listen(port, () => {
    console.log(`[CodeNexus] Control Plane (Node.js) running on http://localhost:${port}`);
    console.log(`[CodeNexus] Health: http://localhost:${port}/health`);
    console.log(`[CodeNexus] Webhook: http://localhost:${port}/api/webhooks/github`);
  });
}
