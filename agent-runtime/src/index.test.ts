import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRuntime } from './index';
import type { LLMConfig } from './llm-provider';

describe('AgentRuntime', () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime();
  });

  describe('Session lifecycle', () => {
    it('creates session with defaults', () => {
      const session = runtime.createSession({
        provider: 'test',
        model: 'test-model',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      expect(session.id).toBeTruthy();
      expect(session.status).toBe('idle');
      expect(session.expiresAt).toBeTruthy();
      expect(session.sandboxId).toBeNull();
      expect(session.config.provider).toBe('test');
    });

    it('getSession returns undefined for unknown id', () => {
      expect(runtime.getSession('unknown-id')).toBeUndefined();
    });

    it('cancelSession sets status to cancelled', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      runtime.cancelSession(session.id);
      const found = runtime.getSession(session.id);
      expect(found?.status).toBe('cancelled');
    });

    it('cancelSession no-ops on already cancelled session', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      runtime.cancelSession(session.id);
      runtime.cancelSession(session.id);
      const found = runtime.getSession(session.id);
      expect(found?.status).toBe('cancelled');
    });

    it('assignSandbox only works on idle sessions', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      runtime.assignSandbox(session.id, 'sandbox-1');
      runtime.assignSandbox(session.id, 'sandbox-2');
      const found = runtime.getSession(session.id);
      expect(found?.sandboxId).toBe('sandbox-1');
    });

    it('onEvent returns unsubscribe function', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      let callCount = 0;
      const unsub = runtime.onEvent(session.id, () => {
        callCount++;
      });
      runtime.completeSession(session.id);
      expect(callCount).toBe(1);

      unsub();
      const s2 = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      runtime.onEvent(s2.id, () => {
        callCount++;
      });
      runtime.completeSession(s2.id);
      expect(callCount).toBe(2);
    });

    it('completeSession emits event and sets status', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      let fired = false;
      runtime.onEvent(session.id, (e) => {
        if (e.type === 'completed') fired = true;
      });
      runtime.completeSession(session.id);
      expect(fired).toBe(true);
      expect(runtime.getSession(session.id)?.status).toBe('completed');
    });

    it('completeSession does not complete a cancelled session', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      runtime.cancelSession(session.id);
      runtime.completeSession(session.id);
      expect(runtime.getSession(session.id)?.status).toBe('cancelled');
    });
  });

  describe('LLM integration', () => {
    it('getLLMStatus returns unconfigured by default', () => {
      const status = runtime.getLLMStatus();
      expect(status.configured).toBe(false);
      expect(status.backend).toBeNull();
    });

    it('configureLLM sets provider', () => {
      const config: LLMConfig = {
        backend: 'deepseek',
        apiKey: 'sk-test',
        model: 'deepseek-chat',
      };
      runtime.configureLLM(config);
      const status = runtime.getLLMStatus();
      expect(status.configured).toBe(true);
      expect(status.backend).toBe('deepseek');
      expect(status.model).toBe('deepseek-chat');
    });

    it('executeReview returns stub when no LLM configured', async () => {
      const response = await runtime.executeReview({
        diff: 'test diff',
        findings: [],
        mode: 'vibe',
      });
      expect(response.content).toContain('LLM not configured');
      expect(response.model).toBe('none');
    });

    it('executeBlindSpotScan returns stub when no LLM configured', async () => {
      const response = await runtime.executeBlindSpotScan({
        diff: 'test diff',
        findings: [],
        mode: 'engineer',
      });
      expect(response.content).toContain('LLM not configured');
      expect(response.model).toBe('none');
    });
  });

  describe('Session expiry', () => {
    it('getSession returns undefined for expired session', () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2026-01-01T00:00:00Z');
        vi.setSystemTime(now);
        const session = runtime.createSession({
          provider: 't',
          model: 't',
          lspEnabled: false,
          maxDepth: 1,
          reasoningEnabled: false,
          reasoningEffort: 'low',
          ttlSeconds: 0,
        });
        vi.advanceTimersByTime(1000);
        const found = runtime.getSession(session.id);
        expect(found).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shutdown clears all state', () => {
      const session = runtime.createSession({
        provider: 't',
        model: 't',
        lspEnabled: false,
        maxDepth: 1,
        reasoningEnabled: false,
        reasoningEffort: 'low',
      });
      expect(runtime.getSession(session.id)).toBeTruthy();
      runtime.shutdown();
      expect(runtime.getSession(session.id)).toBeUndefined();
    });
  });
});
