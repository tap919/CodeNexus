/**
 * CodeNexus Control-Plane — Cloudflare Worker Entry Point
 *
 * Fuses background-agents, agent-reviews, and opencode patterns.
 *
 * Responsibilities:
 *   - GitHub webhook receiver for PR events
 *   - Session management via Durable Objects
 *   - WebSocket hub for real-time streaming
 *   - Orchestration of the full review-fix cycle
 */

import { Router } from "itty-router";
import { jwtVerify } from 'jose';
import { createConfigBinding } from "./config";
import {
  getOrchestrator,
  OrchestratorError,
  ReviewStep,
  REVIEW_STEP_LABELS,
} from "./orchestrator";
import type { GitHubWebhookEvent, AgentMode } from "../../shared/src/types";
import { AgentMode as AgentModeEnum } from "../../shared/src/types";

// ─── Environment Bindings ─────────────────────────────────────

export interface Env {
  SESSION_MANAGER: DurableObjectNamespace;
  CNX_GITHUB_TOKEN: string;
  CNX_GITHUB_APP_ID: string;
  CNX_GITHUB_WEBHOOK_SECRET: string;
  CNX_JWT_SECRET: string;
  CNX_AUTH_PROVIDER?: string;
  CNX_OIDC_ISSUER?: string;
  CNX_OIDC_CLIENTS?: string;
  CNX_AGENT_PROVIDER?: string;
  CNX_AGENT_MODEL?: string;
  CNX_AGENT_LSP_ENABLED?: string;
  CNX_AGENT_MAX_DEPTH?: string;
  CNX_SEC_PROMPT_INJECTION?: string;
  CNX_SEC_DATA_EXFIL?: string;
  CNX_SEC_AGENT_MONITOR?: string;
  CNX_KNOWLEDGE_DIR?: string;
  CNX_KNOWLEDGE_MAX_SOURCES?: string;
  CNX_KNOWLEDGE_MIN_CONFIDENCE?: string;
  CNX_ANALYTICS_PROVIDER?: string;
  CNX_ANALYTICS_DASHBOARD_URL?: string;
  RUN_METADATA?: KVNamespace;
  SENTRY_DSN?: string;
  [key: string]: unknown;
}

// ─── Extended Request ─────────────────────────────────────────

interface RequestWithContext extends Request {
  requestId: string;
  env: Env;
  ctx: ExecutionContext;
  startTime: number;
}

// ─── Router ───────────────────────────────────────────────────

const router = Router();

// ─── Worker Entry ─────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const requestId = crypto.randomUUID().slice(0, 8);
    const startTime = Date.now();

    try {
      // Initialize configuration from environment
      const configBinding = createConfigBinding(
        env as unknown as Record<string, string>,
      );
      await configBinding.load({ lenient: true });

      // Attach context to request
      const req = request as unknown as RequestWithContext;
      req.requestId = requestId;
      req.env = env;
      req.ctx = ctx;
      req.startTime = startTime;

      return await router.handle(req, env, ctx);
    } catch (error) {
      console.error(`[worker] Unhandled error [${requestId}]:`, error);
      return jsonResponse(
        {
          error: "Internal Server Error",
          requestId,
          message: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
};

// ─── Health Check ─────────────────────────────────────────────

router.get("/health", async () => {
  return jsonResponse({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── GitHub Webhook Receiver ──────────────────────────────────

router.post("/api/webhooks/github", async (request: RequestWithContext) => {
  const { env } = request;

  // Validate Content-Type
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return jsonResponse({ error: "Expected JSON content type" }, 415);
  }

  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify webhook signature
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const webhookSecret = env.CNX_GITHUB_WEBHOOK_SECRET;

  if (signature) {
    const isValid = await verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret,
    );
    if (!isValid) {
      console.warn(
        `[webhook] Invalid signature from ${request.headers.get("x-forwarded-for") ?? "unknown"}`,
      );
      return jsonResponse({ error: "Invalid webhook signature" }, 401);
    }
  } else {
    console.warn(
      "[webhook] No signature header present — proceeding without verification",
    );
  }

  // Parse event
  let event: GitHubWebhookEvent;
  try {
    event = JSON.parse(rawBody) as GitHubWebhookEvent;
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const eventType = request.headers.get("x-github-event") ?? "unknown";
  const deliveryId = request.headers.get("x-github-delivery") ?? "unknown";

  console.log(`[webhook] Received ${eventType} event ${deliveryId}`);

  // Filter relevant events
  if (eventType !== "pull_request") {
    return jsonResponse({ message: `Ignored event type: ${eventType}` });
  }

  const action = event.action;
  if (!["opened", "synchronize", "reopened", "labeled"].includes(action)) {
    return jsonResponse({ message: `Ignored PR action: ${action}` });
  }

  // Determine mode from labels or action
  const mode = determineMode(event);

  // Create a Durable Object session
  const sessionId = `session_${event.repository.owner.login}_${event.repository.name}_${event.pullRequest.number}_${Date.now()}`;
  const doId = env.SESSION_MANAGER.idFromName(sessionId);
  const doStub = env.SESSION_MANAGER.get(doId);

  // Initialize session on the Durable Object
  try {
    await doStub.fetch("http://do/api/session/initialize", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        repository: {
          owner: event.repository.owner.login,
          repo: event.repository.name,
          branch: event.pullRequest.head.ref,
          prNumber: event.pullRequest.number,
          cloneUrl: event.repository.cloneUrl,
        },
        comments: [],
        mode,
      }),
      headers: { "Content-Type": "application/json" },
    });

    // Transition to running
    await doStub.fetch("http://do/api/session/transition", {
      method: "POST",
      body: JSON.stringify({ status: "running" }),
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[webhook] Failed to initialize session:`, error);
    return jsonResponse({ error: "Failed to create session" }, 500);
  }

  // Fire-and-forget the orchestration cycle
  // We do not await this so the webhook returns immediately (HTTP 202)
  env.CNX_GITHUB_TOKEN; // referenced to ensure it's available
  const orchestrator = getOrchestrator();

  executeOrchestration(orchestrator, event, sessionId, mode, doStub).catch(
    (error) => {
      console.error(
        `[webhook] Orchestration failed for session ${sessionId}:`,
        error,
      );
    },
  );

  return jsonResponse(
    {
      message: "Webhook received, review initiated",
      sessionId,
      deliveryId,
    },
    202,
  );
});

// ─── WebSocket Hub ────────────────────────────────────────────

router.get(
  "/api/ws/session/:sessionId",
  async (request: RequestWithContext) => {
    const { env } = request;

    // Auth check
    const token = (new URL(request.url).searchParams.get("token")) ||
      request.headers.get("Authorization")?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return jsonResponse({ error: "authentication_required", message: "Bearer token required" }, 401);
    }

    try {
      const jwtSecret = (env.AUTH_JWT_SECRET as string) || process.env.AUTH_JWT_SECRET || '';
      const jwtIssuer = (env.AUTH_JWT_ISSUER as string) || process.env.AUTH_JWT_ISSUER || 'https://auth.codenexus.dev';
      const secret = new TextEncoder().encode(jwtSecret);
      await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        issuer: jwtIssuer,
      });
    } catch {
      return jsonResponse({ error: "invalid_token", message: "Invalid or expired token" }, 401);
    }

    const sessionId =
      (request as unknown as { params: { sessionId: string } }).params
        ?.sessionId ?? new URL(request.url).pathname.split("/").pop();

    if (!sessionId) {
      return jsonResponse({ error: "Session ID is required" }, 400);
    }

    // Verify upgrade header
    if (request.headers.get("Upgrade") !== "websocket") {
      return jsonResponse({ error: "Expected WebSocket upgrade" }, 426);
    }

    try {
      const doId = env.SESSION_MANAGER.idFromName(sessionId);
      const doStub = env.SESSION_MANAGER.get(doId);

      // Forward to the Durable Object which handles the WebSocket upgrade
      return await doStub.fetch(request);
    } catch (error) {
      console.error(`[ws] Failed to connect to session ${sessionId}:`, error);
      return jsonResponse({ error: "Failed to connect to session" }, 500);
    }
  },
);

// ─── Session API ──────────────────────────────────────────────

// Forward all /api/session/* requests to the appropriate Durable Object
router.all("/api/session/:sessionId/*", async (request: RequestWithContext) => {
  // Auth check
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return jsonResponse({ error: "authentication_required" }, 401);
  }

  try {
    const jwtSecret = (request.env.AUTH_JWT_SECRET as string) || process.env.AUTH_JWT_SECRET || '';
    const jwtIssuer = (request.env.AUTH_JWT_ISSUER as string) || process.env.AUTH_JWT_ISSUER || 'https://auth.codenexus.dev';
    const secret = new TextEncoder().encode(jwtSecret);
    await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: jwtIssuer,
    });
  } catch {
    return jsonResponse({ error: "invalid_token" }, 401);
  }

  const pathParts = url.pathname.split("/");
  const sessionId = pathParts[3];

  if (!sessionId) {
    return jsonResponse({ error: "Session ID is required" }, 400);
  }

  try {
    const doId = request.env.SESSION_MANAGER.idFromName(sessionId);
    const doStub = request.env.SESSION_MANAGER.get(doId);

    // Reconstruct the URL path for the DO's internal routing
    const doPath = `/api/session${pathParts.slice(4).join("/") ? "/" + pathParts.slice(4).join("/") : ""}`;
    const doUrl = `http://do${doPath}${url.search}`;

    return await doStub.fetch(doUrl, {
      method: request.method,
      headers: request.headers,
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? request.body
          : undefined,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message?.includes("SESSION_NOT_FOUND")
    ) {
      return jsonResponse({ error: "Session not found" }, 404);
    }
    console.error(`[api] Session proxy error:`, error);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
});

// ─── Orchestration API ────────────────────────────────────────

router.get("/api/orchestrator/runs", async () => {
  const orchestrator = getOrchestrator();
  const runs = orchestrator.getActiveRuns();

  return jsonResponse({
    count: runs.length,
    runs: runs.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      mode: r.mode,
      status: r.overallStatus,
      stepsCompleted: r.results.length,
      startedAt: r.startedAt,
    })),
  });
});

router.get("/api/orchestrator/runs/:runId", async (request: Request) => {
  const url = new URL(request.url);
  const runId = url.pathname.split("/").pop() ?? "";

  const orchestrator = getOrchestrator();
  const run = orchestrator.getRun(runId);

  if (!run) {
    return jsonResponse({ error: "Run not found" }, 404);
  }

  return jsonResponse(run);
});

router.post(
  "/api/orchestrator/runs/:runId/cancel",
  async (request: Request) => {
    const url = new URL(request.url);
    const runId = url.pathname.split("/").pop() ?? "";

    const orchestrator = getOrchestrator();
    const cancelled = orchestrator.cancelRun(runId);

    if (!cancelled) {
      return jsonResponse({ error: "Run not found or already completed" }, 404);
    }

    return jsonResponse({ message: "Run cancelled", runId });
  },
);

// ─── Workflow Engine API ───────────────────────────────────────

router.get("/api/workflows/runs", async () => {
  const orchestrator = getOrchestrator();
  const runs = orchestrator.listWorkflowRuns();

  return jsonResponse({
    count: runs.length,
    runs: runs.map((r) => ({
      id: r.id,
      workflowName: r.workflowName,
      status: r.status,
      stepCount: r.steps.size,
      steps: Array.from(r.steps.entries()).map(([name, s]) => ({
        name,
        status: s.status,
        attempts: s.attempts,
        error: s.error,
      })),
      createdAt: r.createdAt,
    })),
  });
});

router.get("/api/workflows/runs/:runId", async (request: Request) => {
  const url = new URL(request.url);
  const runId = url.pathname.split("/").pop() ?? "";

  const orchestrator = getOrchestrator();
  const run = orchestrator.getWorkflowRun(runId);

  if (!run) {
    return jsonResponse({ error: "Workflow run not found" }, 404);
  }

  return jsonResponse({
    id: run.id,
    workflowName: run.workflowName,
    status: run.status,
    steps: Array.from(run.steps.entries()).map(([name, s]) => ({
      name,
      status: s.status,
      attempts: s.attempts,
      error: s.error,
      startedAt: s.startedAt,
      doneAt: s.doneAt,
    })),
    events: run.events,
    createdAt: run.createdAt,
  });
});

// ─── Orchestration Execution ──────────────────────────────────

async function executeOrchestration(
  orchestrator: ReturnType<typeof getOrchestrator>,
  event: GitHubWebhookEvent,
  sessionId: string,
  mode: AgentMode,
  doStub: DurableObjectNamespace,
): Promise<void> {
  const stepStartTimes = new Map<string, number>();

  try {
    const run = await orchestrator.executeCycle({
      event,
      sessionId,
      mode,
      onStepComplete: async (result) => {
        const duration = result.durationMs;
        const stepName = REVIEW_STEP_LABELS[result.step] ?? result.step;
        const status = result.status;

        console.log(
          `[orchestrator] Step "${stepName}" ${status} in ${duration}ms` +
            (result.error ? ` — ${result.error}` : ""),
        );

        // Emit step completion via DO for WebSocket subscribers
        try {
          await doStub.fetch("http://do/api/session/add-event", {
            method: "POST",
            body: JSON.stringify({
              type: "status",
              data: {
                step: result.step,
                status: result.status,
                durationMs: result.durationMs,
                error: result.error,
              },
            }),
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error('[ControlPlane] Error emitting step event to DO:', err);
        }
      },
    });

    // Mark session as completed (or failed)
    let finalStatus = run.overallStatus;
    if (finalStatus === "running") {
      finalStatus = "completed";
    }

    await doStub.fetch("http://do/api/session/transition", {
      method: "POST",
      body: JSON.stringify({ status: finalStatus }),
      headers: { "Content-Type": "application/json" },
    });

    const totalDuration =
      run.completedAt && run.startedAt
        ? new Date(run.completedAt).getTime() -
          new Date(run.startedAt).getTime()
        : 0;

    console.log(
      `[orchestrator] Session ${sessionId} completed: ${finalStatus} in ${totalDuration}ms ` +
        `(${run.results.filter((r) => r.status === "success").length}/${run.results.length} steps successful)`,
    );
  } catch (error) {
    console.error(
      `[orchestrator] Fatal orchestration error for session ${sessionId}:`,
      error,
    );

    try {
      await doStub.fetch("http://do/api/session/transition", {
        method: "POST",
        body: JSON.stringify({ status: "failed" }),
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error('[ControlPlane] Error transitioning session to failed:', err);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 */
async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const expectedSig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload),
    );
    const expectedHex = Array.from(new Uint8Array(expectedSig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const expectedPrefix = "sha256=";
    const actualSig = signature.startsWith(expectedPrefix)
      ? signature.slice(expectedPrefix.length)
      : signature;

    // Constant-time comparison
    if (actualSig.length !== expectedHex.length) return false;

    let result = 0;
    for (let i = 0; i < actualSig.length; i++) {
      result |= actualSig.charCodeAt(i) ^ expectedHex.charCodeAt(i);
    }
    return result === 0;
  } catch (error) {
    console.error("[webhook] Signature verification error:", error);
    return false;
  }
}

/**
 * Determine agent mode from PR labels or event action.
 */
function determineMode(event: GitHubWebhookEvent): AgentMode {
  const title = event.pullRequest?.title?.toLowerCase() ?? "";
  const body = event.pullRequest?.body?.toLowerCase() ?? "";

  // Check for fix-related keywords
  if (
    title.startsWith("fix") ||
    title.startsWith("hotfix") ||
    body.includes("autofix")
  ) {
    return AgentModeEnum.Fix;
  }

  // Check for planning-related keywords
  if (
    title.startsWith("plan") ||
    title.startsWith("rfc") ||
    title.startsWith("adr")
  ) {
    return AgentModeEnum.Plan;
  }

  // Check for build-related keywords
  if (
    title.startsWith("feat") ||
    title.startsWith("build") ||
    title.startsWith("chore")
  ) {
    return AgentModeEnum.Build;
  }

  return AgentModeEnum.Review;
}

/**
 * Helper to return a JSON response.
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": crypto.randomUUID().slice(0, 8),
    },
  });
}

// ─── Re-export for wrangler configuration ─────────────────────

export { SessionManager } from "./session-manager";
export { REVIEW_STEP_LABELS } from "./orchestrator";
