import type { DurableObjectState, DurableObjectStorage } from '@cloudflare/workers-types';
import {
  type OrchestrationSession,
  type RepositoryInfo,
  type ReviewComment,
  type AgentEvent,
  type ReviewMetric,
  type SandboxSpec,
  type AgentMode,
  SessionStatus,
} from '../../shared/src/types';

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_ACTIVITY_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes
const QUEUE_POLL_INTERVAL_MS = 100;
const MAX_CHILD_SESSIONS = 10;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

// ─── Queue Types ──────────────────────────────────────────────

export interface QueueItem {
  id: string;
  prompt: string;
  mode: AgentMode;
  priority: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ─── Session State ────────────────────────────────────────────

export interface SessionState {
  session: OrchestrationSession;
  queue: QueueItem[];
  sandboxId: string | null;
  sandboxSpec: SandboxSpec | null;
  childSessionIds: string[];
  activityTimeout: number;
  lastActivityAt: number;
  createdAt: number;
  snapshotId: string | null;
  retryCount: number;
  maxRetries: number;
}

// ─── Errors ───────────────────────────────────────────────────

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly sessionId: string,
    public readonly code: SessionErrorCode,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export type SessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_COMPLETED'
  | 'SESSION_TIMEOUT'
  | 'SESSION_CANCELLED'
  | 'QUEUE_FULL'
  | 'INVALID_TRANSITION'
  | 'MAX_CHILD_SESSIONS_REACHED'
  | 'SANDBOX_SPAWN_FAILED'
  | 'SANDBOX_RESTORE_FAILED'
  | 'SANDBOX_SNAPSHOT_FAILED';

// ─── valid Transitions ────────────────────────────────────────

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  [SessionStatus.Pending]: [SessionStatus.Running, SessionStatus.Cancelled, SessionStatus.Failed],
  [SessionStatus.Running]: [SessionStatus.Completed, SessionStatus.Failed, SessionStatus.Cancelled],
  [SessionStatus.Completed]: [],
  [SessionStatus.Failed]: [SessionStatus.Pending], // allow retry
  [SessionStatus.Cancelled]: [],
};

function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Session Manager Durable Object ───────────────────────────

export class SessionManager implements DurableObject {
  private state: DurableObjectState;
  private storage: DurableObjectStorage;
  private sessionState: SessionState | null = null;
  private alarmScheduled = false;
  private abortController = new AbortController();

  private static readonly MAX_QUEUE_SIZE = 100;

  // WebSocket clients for real-time streaming
  private wsClients = new Set<WebSocket>();

  constructor(ctx: DurableObjectState) {
    this.state = ctx;
    this.storage = ctx.storage;

    // Rehydrate from storage on wake
    ctx.blockConcurrencyWhile(async () => {
      const stored = await this.storage.get<SessionState>('sessionState');
      if (stored) {
        this.sessionState = stored;
        this.checkActivityTimeout();
      }
    });

    // Listen for alarm (activity timeout / cron)
    ctx.setAlarm?.();
  }

  // ─── Public API ──────────────────────────────────────────

  /**
   * Initialize a new session from a webhook event.
   */
  async initialize(params: {
    sessionId: string;
    repository: RepositoryInfo;
    comments: ReviewComment[];
    mode: AgentMode;
    sandboxSpec?: SandboxSpec;
    activityTimeout?: number;
    maxRetries?: number;
  }): Promise<OrchestrationSession> {
    if (this.sessionState) {
      throw new SessionError(
        'Session already initialized',
        params.sessionId,
        'SESSION_ALREADY_COMPLETED',
      );
    }

    const now = new Date().toISOString();
    const session: OrchestrationSession = {
      id: params.sessionId,
      repository: params.repository,
      comments: params.comments,
      mode: params.mode,
      status: SessionStatus.Pending,
      sandboxId: null,
      childSessions: [],
      events: [],
      metrics: this.createEmptyMetrics(params.repository, params.sessionId),
      createdAt: now,
      updatedAt: now,
    };

    this.sessionState = {
      session,
      queue: [],
      sandboxId: null,
      sandboxSpec: params.sandboxSpec ?? null,
      childSessionIds: [],
      activityTimeout: params.activityTimeout ?? DEFAULT_ACTIVITY_TIMEOUT_MS,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      snapshotId: null,
      retryCount: 0,
      maxRetries: params.maxRetries ?? 3,
    };

    await this.persist();

    this.broadcast({ type: 'session_created', session });

    return session;
  }

  /**
   * Get current session state.
   */
  async getSession(): Promise<OrchestrationSession> {
    this.ensureSessionExists();
    return this.sessionState!.session;
  }

  /**
   * Transition the session state machine.
   */
  async transition(newStatus: SessionStatus): Promise<OrchestrationSession> {
    this.ensureSessionExists();

    const current = this.sessionState!.session.status;

    if (!canTransition(current, newStatus)) {
      throw new SessionError(
        `Cannot transition from ${current} to ${newStatus}`,
        this.sessionState!.session.id,
        'INVALID_TRANSITION',
      );
    }

    this.sessionState!.session.status = newStatus;
    this.sessionState!.session.updatedAt = new Date().toISOString();
    this.sessionState!.lastActivityAt = Date.now();

    // Record transition event
    this.recordEvent('status', { from: current, to: newStatus });

    if (newStatus === SessionStatus.Completed || newStatus === SessionStatus.Failed || newStatus === SessionStatus.Cancelled) {
      this.cleanup();
    }

    await this.persist();
    this.broadcast({ type: 'session_transition', sessionId: this.sessionState!.session.id, from: current, to: newStatus });

    return this.sessionState!.session;
  }

  /**
   * Enqueue a prompt into the FIFO queue.
   */
  async enqueuePrompt(item: Omit<QueueItem, 'id' | 'createdAt'>): Promise<QueueItem> {
    this.ensureSessionExists();

    if (this.sessionState!.queue.length >= SessionManager.MAX_QUEUE_SIZE) {
      throw new SessionError(
        `Prompt queue is at capacity (max ${SessionManager.MAX_QUEUE_SIZE} items)`,
        this.sessionState!.session.id,
        'QUEUE_FULL',
      );
    }

    this.ensureRunning();

    const queueItem: QueueItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    // Insert in priority order (higher priority first), then FIFO
    const insertIndex = this.sessionState!.queue.findIndex(
      (q) => q.priority < item.priority,
    );
    if (insertIndex === -1) {
      this.sessionState!.queue.push(queueItem);
    } else {
      this.sessionState!.queue.splice(insertIndex, 0, queueItem);
    }

    this.sessionState!.lastActivityAt = Date.now();
    await this.persist();

    this.broadcast({ type: 'prompt_enqueued', item: queueItem });

    return queueItem;
  }

  /**
   * Dequeue the next prompt (FIFO with priority ordering).
   */
  async dequeuePrompt(): Promise<QueueItem | null> {
    this.ensureSessionExists();

    if (this.sessionState!.queue.length === 0) return null;

    const item = this.sessionState!.queue.shift()!;
    this.sessionState!.lastActivityAt = Date.now();
    await this.persist();

    return item;
  }

  /**
   * Peek at the queue without dequeuing.
   */
  async peekQueue(): Promise<QueueItem[]> {
    this.ensureSessionExists();
    return [...this.sessionState!.queue];
  }

  /**
   * Spawn a sandbox for this session.
   */
  async spawnSandbox(spec: SandboxSpec): Promise<string> {
    this.ensureSessionExists();

    const sandboxId = crypto.randomUUID();

    try {
      // In production, this would call the agent runtime to create a sandbox
      this.sessionState!.sandboxId = sandboxId;
      this.sessionState!.sandboxSpec = spec;
      this.sessionState!.session.sandboxId = sandboxId;
      this.sessionState!.lastActivityAt = Date.now();

      this.recordEvent('sandbox_spawned', { sandboxId, spec });

      await this.persist();
      this.broadcast({ type: 'sandbox_spawned', sandboxId, spec });

      return sandboxId;
    } catch (error) {
      throw new SessionError(
        `Failed to spawn sandbox: ${error}`,
        this.sessionState!.session.id,
        'SANDBOX_SPAWN_FAILED',
      );
    }
  }

  /**
   * Restore from a sandbox snapshot.
   */
  async restoreSandbox(snapshotId: string): Promise<string> {
    this.ensureSessionExists();

    try {
      const newSandboxId = crypto.randomUUID();
      this.sessionState!.sandboxId = newSandboxId;
      this.sessionState!.snapshotId = snapshotId;
      this.sessionState!.session.sandboxId = newSandboxId;
      this.sessionState!.lastActivityAt = Date.now();

      this.recordEvent('sandbox_restored', { snapshotId, newSandboxId });

      await this.persist();
      this.broadcast({ type: 'sandbox_restored', snapshotId, newSandboxId });

      return newSandboxId;
    } catch (error) {
      throw new SessionError(
        `Failed to restore sandbox: ${error}`,
        this.sessionState!.session.id,
        'SANDBOX_RESTORE_FAILED',
      );
    }
  }

  /**
   * Create a snapshot of the current sandbox state.
   */
  async createSnapshot(): Promise<string> {
    this.ensureSessionExists();

    if (!this.sessionState!.sandboxId) {
      throw new SessionError(
        'No sandbox to snapshot',
        this.sessionState!.session.id,
        'SANDBOX_SNAPSHOT_FAILED',
      );
    }

    const snapshotId = crypto.randomUUID();
    this.sessionState!.snapshotId = snapshotId;
    this.sessionState!.lastActivityAt = Date.now();

    this.recordEvent('snapshot_created', { snapshotId, sandboxId: this.sessionState!.sandboxId });

    await this.persist();
    this.broadcast({ type: 'snapshot_created', snapshotId });

    return snapshotId;
  }

  /**
   * Spawn a child session for a sub-task.
   */
  async spawnChildSession(params: {
    sessionId: string;
    prompt: string;
    mode: AgentMode;
  }): Promise<string> {
    this.ensureSessionExists();

    if (this.sessionState!.childSessionIds.length >= MAX_CHILD_SESSIONS) {
      throw new SessionError(
        `Maximum child sessions (${MAX_CHILD_SESSIONS}) reached`,
        this.sessionState!.session.id,
        'MAX_CHILD_SESSIONS_REACHED',
      );
    }

    const childId = params.sessionId;
    this.sessionState!.childSessionIds.push(childId);
    this.sessionState!.session.childSessions.push(childId);
    this.sessionState!.lastActivityAt = Date.now();

    this.recordEvent('child_spawned', { childId, prompt: params.prompt, mode: params.mode });

    await this.persist();
    this.broadcast({ type: 'child_spawned', childId, parentId: this.sessionState!.session.id });

    return childId;
  }

  /**
   * Get list of child session IDs.
   */
  async getChildSessions(): Promise<string[]> {
    this.ensureSessionExists();
    return [...this.sessionState!.childSessionIds];
  }

  /**
   * Add an event to the session event log.
   */
  async addEvent(event: Omit<AgentEvent, 'timestamp'>): Promise<void> {
    this.ensureSessionExists();

    const fullEvent: AgentEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.sessionState!.session.events.push(fullEvent);
    this.sessionState!.lastActivityAt = Date.now();

    // Keep only last 1000 events to prevent memory bloat
    if (this.sessionState!.session.events.length > 1000) {
      this.sessionState!.session.events = this.sessionState!.session.events.slice(-1000);
    }

    await this.persist();
    this.broadcast({ type: 'event', event: fullEvent });
  }

  /**
   * Update review metrics.
   */
  async updateMetrics(updates: Partial<ReviewMetric>): Promise<ReviewMetric> {
    this.ensureSessionExists();

    this.sessionState!.session.metrics = {
      ...this.sessionState!.session.metrics,
      ...updates,
    };
    this.sessionState!.lastActivityAt = Date.now();

    await this.persist();
    this.broadcast({ type: 'metrics_updated', metrics: this.sessionState!.session.metrics });

    return this.sessionState!.session.metrics;
  }

  /**
   * Reset activity timeout (call on any activity).
   */
  async touch(): Promise<void> {
    this.ensureSessionExists();
    this.sessionState!.lastActivityAt = Date.now();
    await this.persist();
  }

  /**
   * Cancel the session.
   */
  async cancel(): Promise<OrchestrationSession> {
    return this.transition(SessionStatus.Cancelled);
  }

  /**
   * Get session state for debugging.
   */
  async getDebugState(): Promise<SessionState> {
    this.ensureSessionExists();
    return { ...this.sessionState! };
  }

  // ─── WebSocket / Real-Time ───────────────────────────────

  /**
   * Register a WebSocket client for real-time event streaming.
   */
  async registerWebSocket(ws: WebSocket): Promise<void> {
    this.wsClients.add(ws);

    ws.addEventListener('close', () => {
      this.wsClients.delete(ws);
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleWSMessage(ws, data);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    // Send initial state
    if (this.sessionState) {
      ws.send(JSON.stringify({
        type: 'session_state',
        session: this.sessionState.session,
        queueLength: this.sessionState.queue.length,
      }));
    }
  }

  // ─── Alarm / Cron ────────────────────────────────────────

  /**
   * Alarm handler for activity timeout checks.
   */
  async alarm(): Promise<void> {
    this.alarmScheduled = false;
    this.checkActivityTimeout();

    // Periodic snapshot
    if (this.sessionState?.sandboxId && this.sessionState.session.status === SessionStatus.Running) {
      try {
        await this.createSnapshot();
      } catch (error) {
        console.warn(`[session] Snapshot failed: ${error}`);
      }
    }
  }

  // ─── Request Handler (for DO fetch) ──────────────────────

  /**
   * Handle fetch requests routed to this Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    try {
      switch (`${method} ${url.pathname}`) {
        case 'GET /api/session':
          return this.jsonResponse(await this.getSession());

        case 'GET /api/session/debug':
          return this.jsonResponse(await this.getDebugState());

        case 'GET /api/session/events':
          return this.jsonResponse(await this.getSession().then(s => s.events));

        case 'GET /api/session/queue':
          return this.jsonResponse(await this.peekQueue());

        case 'GET /api/session/children':
          return this.jsonResponse(await this.getChildSessions());

        case 'POST /api/session/initialize':
          return this.handleJsonBody(request, async (body) => {
            const session = await this.initialize(body);
            return this.jsonResponse(session, 201);
          });

        case 'POST /api/session/transition':
          return this.handleJsonBody(request, async (body) => {
            const session = await this.transition(body.status as SessionStatus);
            return this.jsonResponse(session);
          });

        case 'POST /api/session/enqueue':
          return this.handleJsonBody(request, async (body) => {
            const item = await this.enqueuePrompt(body);
            return this.jsonResponse(item, 201);
          });

        case 'POST /api/session/dequeue':
          return this.jsonResponse(await this.dequeuePrompt());

        case 'POST /api/session/spawn-sandbox':
          return this.handleJsonBody(request, async (body) => {
            const sandboxId = await this.spawnSandbox(body.spec as SandboxSpec);
            return this.jsonResponse({ sandboxId });
          });

        case 'POST /api/session/snapshot':
          return this.jsonResponse({ snapshotId: await this.createSnapshot() });

        case 'POST /api/session/touch':
          await this.touch();
          return this.jsonResponse({ ok: true });

        case 'POST /api/session/cancel':
          return this.jsonResponse(await this.cancel());

        case 'POST /api/session/add-event':
          return this.handleJsonBody(request, async (body) => {
            await this.addEvent(body);
            return this.jsonResponse({ ok: true });
          });

        case 'POST /api/session/update-metrics':
          return this.handleJsonBody(request, async (body) => {
            const metrics = await this.updateMetrics(body);
            return this.jsonResponse(metrics);
          });

        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      if (error instanceof SessionError) {
        return this.jsonResponse({ error: error.message, code: error.code }, 400);
      }
      console.error(`[session] Unhandled error:`, error);
      return this.jsonResponse({ error: 'Internal Server Error' }, 500);
    }
  }

  // ─── Private ─────────────────────────────────────────────

  private ensureSessionExists(): void {
    if (!this.sessionState) {
      throw new SessionError(
        'Session not found',
        'unknown',
        'SESSION_NOT_FOUND',
      );
    }
  }

  private ensureRunning(): void {
    if (this.sessionState!.session.status !== SessionStatus.Running) {
      throw new SessionError(
        `Session is not running (status: ${this.sessionState!.session.status})`,
        this.sessionState!.session.id,
        'INVALID_TRANSITION',
      );
    }
  }

  private checkActivityTimeout(): void {
    if (!this.sessionState) return;

    const elapsed = Date.now() - this.sessionState.lastActivityAt;
    if (elapsed > this.sessionState.activityTimeout) {
      console.warn(`[session] Activity timeout for session ${this.sessionState.session.id}`);
      this.transition(SessionStatus.Failed).catch((err) => {
        console.error(`[session] Failed to mark session as timed out:`, err);
      });
    }
  }

  private recordEvent(type: AgentEvent['type'], data: Record<string, unknown>): void {
    this.sessionState?.session.events.push({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
    // Cap event buffer to prevent unbounded memory growth
    const maxEvents = 1000;
    while (this.sessionState && this.sessionState.session.events.length > maxEvents) {
      this.sessionState.session.events.shift();
    }
  }

  private async persist(): Promise<void> {
    if (this.sessionState) {
      await this.state.storage.put('sessionState', this.sessionState);

      // Schedule periodic alarm
      if (!this.alarmScheduled && this.sessionState.session.status === SessionStatus.Running) {
        await this.state.storage.setAlarm(Date.now() + SNAPSHOT_INTERVAL_MS);
        this.alarmScheduled = true;
      }
    }
  }

  private cleanup(): void {
    // Destroy sandbox if exists
    if (this.sessionState?.sandboxId) {
      console.log(`[SessionManager] Cleaning up sandbox: ${this.sessionState.sandboxId}`);
      // Sandbox destruction is delegated to the orchestrator adapter
      this.sessionState.sandboxId = null;
    }

    this.abortController.abort();
    this.wsClients.forEach((ws) => {
      try { ws.close(1000, 'Session completed'); } catch { /* ignore */ }
    });
    this.wsClients.clear();
  }

  private broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    this.wsClients.forEach((ws) => {
      try { ws.send(message); } catch {
        this.wsClients.delete(ws);
      }
    });
  }

  private handleWSMessage(ws: WebSocket, data: Record<string, unknown>): void {
    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'subscribe_event':
        // Already subscribed by default
        ws.send(JSON.stringify({ type: 'subscribed' }));
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
    }
  }

  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.registerWebSocket(server).catch((err) => {
      console.error('[session] WS registration error:', err);
      server.close(1011, 'Internal error');
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleJsonBody(
    request: Request,
    handler: (body: Record<string, unknown>) => Promise<Response>,
  ): Promise<Response> {
    try {
      const body = await request.json() as Record<string, unknown>;
      return handler(body);
    } catch {
      return this.jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private createEmptyMetrics(repo: RepositoryInfo, sessionId: string): ReviewMetric {
    return {
      prNumber: repo.prNumber ?? 0,
      repository: `${repo.owner}/${repo.repo}`,
      totalComments: 0,
      botComments: 0,
      humanComments: 0,
      fixesApplied: 0,
      timeToFix: 0,
      confidence: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

export default SessionManager;
