import { v4 as uuidv4 } from 'uuid';

export type AgentSessionStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface AgentSessionConfig {
  provider: string;
  model: string;
  lspEnabled: boolean;
  maxDepth: number;
  reasoningEnabled: boolean;
  reasoningEffort: 'low' | 'medium' | 'high';
}

export interface AgentSession {
  id: string;
  config: AgentSessionConfig;
  status: AgentSessionStatus;
  sandboxId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvent {
  sessionId: string;
  type: string;
  data: unknown;
  timestamp: string;
}

type EventListener = (event: AgentEvent) => void;

export class AgentRuntime {
  private sessions: Map<string, AgentSession> = new Map();
  private listeners: Map<string, Set<EventListener>> = new Map();

  createSession(config: AgentSessionConfig): AgentSession {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: uuidv4(),
      config,
      status: 'idle',
      sandboxId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  getSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status === 'completed' || session.status === 'failed') return;
    session.status = 'failed';
    session.updatedAt = new Date().toISOString();
    this.emitEvent({ sessionId, type: 'cancelled', data: null, timestamp: session.updatedAt });
  }

  completeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'completed';
    session.updatedAt = new Date().toISOString();
    this.emitEvent({ sessionId, type: 'completed', data: null, timestamp: session.updatedAt });
  }

  assignSandbox(sessionId: string, sandboxId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.sandboxId = sandboxId;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    this.emitEvent({ sessionId, type: 'sandbox_assigned', data: { sandboxId }, timestamp: session.updatedAt });
  }

  onEvent(sessionId: string, listener: EventListener): void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);
  }

  private emitEvent(event: AgentEvent): void {
    const sessionListeners = this.listeners.get(event.sessionId);
    if (sessionListeners) {
      for (const listener of sessionListeners) {
        try { listener(event); } catch { /* best effort */ }
      }
    }
  }
}
