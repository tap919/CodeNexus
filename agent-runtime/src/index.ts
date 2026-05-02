import { v4 as uuidv4 } from 'uuid';
import { LLMProvider, type LLMConfig, type LLMResponse } from './llm-provider';
import { buildReviewPrompt, buildBlindSpotPrompt, type ReviewContext } from './review-prompts';

export type AgentSessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentEventType = 'cancelled' | 'completed' | 'sandbox_assigned' | 'session_expired';

export interface AgentSessionConfig {
  provider: string;
  model: string;
  lspEnabled: boolean;
  maxDepth: number;
  reasoningEnabled: boolean;
  reasoningEffort: 'low' | 'medium' | 'high';
  /** Session TTL in seconds (default: 3600 = 1 hour) */
  ttlSeconds?: number;
}

export interface AgentSession {
  id: string;
  config: AgentSessionConfig;
  status: AgentSessionStatus;
  sandboxId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AgentEvent {
  sessionId: string;
  type: AgentEventType;
  data: unknown;
  timestamp: string;
}

type EventListener = (event: AgentEvent) => void;

const DEFAULT_TTL_SECONDS = 3600;

export class AgentRuntime {
  private sessions: Map<string, AgentSession> = new Map();
  private listeners: Map<string, Set<EventListener>> = new Map();
  private expiryInterval: ReturnType<typeof setInterval> | null = null;
  private llm: LLMProvider | null = null;
  private llmConfig: LLMConfig | null = null;

  constructor() {
    this.expiryInterval = setInterval(() => this.sweepExpired(), 60_000);
    if (this.expiryInterval.unref) this.expiryInterval.unref();
  }

  createSession(config: AgentSessionConfig): AgentSession {
    const now = new Date();
    const ttl = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const session: AgentSession = {
      id: uuidv4(),
      config,
      status: 'idle',
      sandboxId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  getSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return { ...session };
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') return;
    session.status = 'cancelled';
    session.updatedAt = new Date().toISOString();
    this.emitEvent({ sessionId, type: 'cancelled', data: null, timestamp: session.updatedAt });
  }

  completeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status === 'cancelled') return;
    session.status = 'completed';
    session.updatedAt = new Date().toISOString();
    this.emitEvent({ sessionId, type: 'completed', data: null, timestamp: session.updatedAt });
  }

  assignSandbox(sessionId: string, sandboxId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status !== 'idle') return;
    session.sandboxId = sandboxId;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    this.emitEvent({ sessionId, type: 'sandbox_assigned', data: { sandboxId }, timestamp: session.updatedAt });
  }

  onEvent(sessionId: string, listener: EventListener): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);
    return () => {
      this.listeners.get(sessionId)?.delete(listener);
    };
  }

  private emitEvent(event: AgentEvent): void {
    const sessionListeners = this.listeners.get(event.sessionId);
    if (sessionListeners) {
      for (const listener of sessionListeners) {
        try {
          listener(event);
        } catch (err) {
          console.error(`[AgentRuntime] Listener error for session ${event.sessionId}:`, err);
        }
      }
    }
  }

  private isExpired(session: AgentSession): boolean {
    return new Date(session.expiresAt).getTime() < Date.now();
  }

  private sweepExpired(): void {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.emitEvent({ sessionId: id, type: 'session_expired', data: null, timestamp: new Date().toISOString() });
        this.sessions.delete(id);
        this.listeners.delete(id);
      }
    }
  }

  configureLLM(config: LLMConfig): void {
    this.llmConfig = config;
    this.llm = new LLMProvider(config);
  }

  async executeReview(context: ReviewContext): Promise<LLMResponse> {
    if (!this.llm) {
      return {
        content: 'LLM not configured. Review unavailable.',
        model: 'none',
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: 'stop',
      };
    }
    const { messages } = buildReviewPrompt(context);
    return this.llm.chat(messages);
  }

  async executeBlindSpotScan(context: ReviewContext): Promise<LLMResponse> {
    if (!this.llm) {
      return {
        content: 'LLM not configured. Blind spot scan unavailable.',
        model: 'none',
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: 'stop',
      };
    }
    const messages = buildBlindSpotPrompt(context);
    return this.llm.chat(messages);
  }

  getLLMStatus(): { configured: boolean; backend: string | null; model: string | null } {
    return {
      configured: this.llm !== null && this.llmConfig !== null,
      backend: this.llmConfig?.backend ?? null,
      model: this.llmConfig?.model ?? null,
    };
  }

  shutdown(): void {
    if (this.expiryInterval) {
      clearInterval(this.expiryInterval);
      this.expiryInterval = null;
    }
    this.sessions.clear();
    this.listeners.clear();
  }
}
