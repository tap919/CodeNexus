import type {
  UserSession,
  AccessControlRule,
  AgentConfig,
  AgentMode,
  AgentSession,
  AgentEvent,
  SandboxSpec,
} from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { AgentRuntime } from '@codenexus/agent-runtime';
import { LLMProvider, type LLMConfig } from '@codenexus/agent-runtime';

const runtime = new AgentRuntime();

export function createDefaultAgentRuntime(): ModuleAdapters['agentRuntime'] {
  return {
    async createSession(config: AgentConfig, prompt: string, mode: AgentMode): Promise<AgentSession> {
      const llmConfig: LLMConfig = {
        backend: mapProvider(config.provider),
        model: config.model,
        apiKey: resolveApiKey(config.provider),
        maxTokens: 4096,
        temperature: 0.3,
      };

      runtime.configureLLM(llmConfig);

      const session = runtime.createSession({
        provider: config.provider,
        model: config.model,
        lspEnabled: config.lspEnabled,
        maxDepth: config.maxDepth,
        reasoningEnabled: true,
        reasoningEffort: config.reasoningEffort ?? 'medium',
      });

      return {
        id: session.id,
        status: 'completed',
        mode,
        repository: { owner: '', repo: '', branch: '', prNumber: null, cloneUrl: '' },
        prompt,
        events: [],
        startedAt: session.createdAt,
        completedAt: session.expiresAt,
      };
    },

    async executePrompt(sessionId: string, prompt: string): Promise<string> {
      if (!runtime.getLLMStatus().configured) {
        runtime.configureLLM({
          backend: 'opencode',
          model: 'gpt-4o',
          maxTokens: 4096,
          temperature: 0.3,
        });
      }

      const response = await runtime.executeReview({
        prTitle: prompt.slice(0, 200),
        prBody: '',
        diff: prompt,
        mode: 'review',
      });

      return response.content;
    },

    async streamEvents(_sessionId: string): AsyncIterable<AgentEvent> {
      return (async function* () {})();
    },

    async spawnSandbox(_spec: SandboxSpec): Promise<string> {
      return crypto.randomUUID();
    },

    async destroySandbox(_sandboxId: string): Promise<void> {},
  };
}

function mapProvider(provider: string): string {
  const map: Record<string, string> = {
    openai: 'opencode',
    anthropic: 'opencode',
    deepseek: 'deepseek',
    openrouter: 'openrouter',
  };
  return map[provider.toLowerCase()] ?? 'opencode';
}

function resolveApiKey(provider: string): string {
  const keyMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const envKey = keyMap[provider.toLowerCase()] ?? 'OPENAI_API_KEY';
  return process.env[envKey] ?? '';
}
