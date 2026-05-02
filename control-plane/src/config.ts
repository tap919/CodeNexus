import { z } from 'zod';
import type { CodeNexusConfig, OIDCClient } from '../../shared/src/types';

// ─── Zod Schemas for Runtime Validation ───────────────────────

const OIDCClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  redirectUris: z.array(z.string().url()),
  grantTypes: z.array(z.string().min(1)),
  scopes: z.array(z.string().min(1)),
}) satisfies z.ZodType<OIDCClient>;

const AuthConfigSchema = z.object({
  provider: z.string().default('github'),
  jwtSecret: z.string().min(16, 'JWT secret must be at least 16 characters'),
  oidc: z.object({
    issuer: z.string().url(),
    clients: z.array(OIDCClientSchema).default([]),
  }),
});

const GitHubConfigSchema = z.object({
  token: z.string().min(1, 'GitHub token is required'),
  appId: z.string().min(1, 'GitHub App ID is required'),
  webhookSecret: z.string().min(1, 'Webhook secret is required'),
});

const AgentConfigSchema = z.object({
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o'),
  lspEnabled: z.boolean().default(true),
  maxDepth: z.number().int().min(1).max(50).default(10),
});

const SecurityConfigSchema = z.object({
  promptInjection: z.boolean().default(true),
  dataExfiltration: z.boolean().default(true),
  agentMonitoring: z.boolean().default(true),
});

const KnowledgeConfigSchema = z.object({
  bookDirectory: z.string().default('./knowledge-books'),
  maxSources: z.number().int().min(1).max(100).default(10),
  minConfidence: z.number().min(0).max(1).default(0.6),
});

const AnalyticsConfigSchema = z.object({
  provider: z.string().default('superset'),
  dashboardUrl: z.string().url().optional(),
});

const CodeNexusConfigSchema = z.object({
  auth: AuthConfigSchema,
  github: GitHubConfigSchema,
  agent: AgentConfigSchema,
  security: SecurityConfigSchema,
  knowledge: KnowledgeConfigSchema,
  analytics: AnalyticsConfigSchema,
}) satisfies z.ZodType<CodeNexusConfig>;

// ─── Environment Variable Keys ────────────────────────────────

const ENV_PREFIX = 'CNX_';

function envKey(suffix: string): string {
  return `${ENV_PREFIX}${suffix}`;
}

// ─── Parsing Helpers ──────────────────────────────────────────

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseJSON<T>(value: string | undefined, fallback: T): T {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ─── Remote Config Fetcher (YAML) ─────────────────────────────

interface ConfigSource {
  url?: string;
  path?: string;
}

async function fetchRemoteConfig(source: ConfigSource): Promise<Partial<CodeNexusConfig> | null> {
  if (!source.url) return null;

  try {
    const response = await fetch(source.url, {
      headers: { 'Accept': 'application/json, application/yaml' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      console.warn(`[config] Remote config fetch failed: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    if (contentType.includes('json') || source.url.endsWith('.json')) {
      return JSON.parse(text) as Partial<CodeNexusConfig>;
    }

    // Simple YAML-like parser for flat overrides
    return parseYamlLike(text);
  } catch (error) {
    console.warn(`[config] Remote config fetch error: ${error}`);
    return null;
  }
}

/**
 * Minimal YAML-like parser for flat key-value overrides.
 * Supports nested keys like "auth.jwtSecret".
 */
function parseYamlLike(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value: unknown = trimmed.slice(colonIndex + 1).trim();

    // Remove surrounding quotes
    if (typeof value === 'string') {
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (/^\d+$/.test(value)) {
        value = Number.parseInt(value as string, 10);
      } else if (/^\d+\.\d+$/.test(value)) {
        value = Number.parseFloat(value as string);
      }
    }

    setNestedValue(result, key, value);
  }

  return result;
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

// ─── Configuration Error ──────────────────────────────────────

export class ConfigurationError extends Error {
  public readonly code: string;
  public readonly fields: string[];

  constructor(message: string, fields: string[] = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = 'CONFIG_ERROR';
    this.fields = fields;
  }
}

// ─── Configuration Loader ─────────────────────────────────────

export interface ConfigLoadOptions {
  /** URL or path to YAML/JSON config file */
  source?: ConfigSource;
  /** Override specific values programmatically */
  overrides?: Partial<CodeNexusConfig>;
  /** Allow partial config with missing optional values */
  lenient?: boolean;
}

let cachedConfig: CodeNexusConfig | null = null;

/**
 * Load and validate the CodeNexus configuration.
 *
 * Resolution order (later overrides earlier):
 * 1. Default values
 * 2. Remote YAML/JSON config (if source provided)
 * 3. Environment variables (CNX_*)
 * 4. Programmatic overrides
 *
 * Results are cached after first load for the lifetime of the worker.
 */
export async function loadConfig(
  options: ConfigLoadOptions = {},
  env: Record<string, string> = {},
): Promise<CodeNexusConfig> {
  if (cachedConfig) return cachedConfig;

  // Step 1: Build partial from defaults
  const partial: Partial<CodeNexusConfig> = {};

  // Step 2: Remote config
  if (options.source) {
    const remote = await fetchRemoteConfig(options.source);
    if (remote) {
      mergeConfig(partial, remote);
    }
  }

  // Step 3: Environment variables
  applyEnvOverrides(partial, env);

  // Step 4: Programmatic overrides
  if (options.overrides) {
    mergeConfig(partial, options.overrides);
  }

  // Validate
  const result = CodeNexusConfigSchema.safeParse(partial);

  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.'));
    const messages = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );

    if (options.lenient) {
      console.warn(`[config] Partial configuration loaded with ${fields.length} warnings:\n${messages.join('\n')}`);
      cachedConfig = partial as CodeNexusConfig;
      return cachedConfig;
    }

    throw new ConfigurationError(
      `Configuration validation failed:\n${messages.join('\n')}`,
      fields,
    );
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/**
 * Invalidate the cached configuration so the next load() re-fetches.
 */
export function invalidateConfig(): void {
  cachedConfig = null;
}

/**
 * Get the current configuration without reloading.
 * Throws if loadConfig() has not been called yet.
 */
export function getConfig(): CodeNexusConfig {
  if (!cachedConfig) {
    throw new ConfigurationError(
      'Configuration not loaded. Call loadConfig() first.',
    );
  }
  return cachedConfig;
}

// ─── Internal Helpers ─────────────────────────────────────────

function mergeConfig(target: Partial<CodeNexusConfig>, source: Partial<CodeNexusConfig>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

function applyEnvOverrides(
  config: Partial<CodeNexusConfig>,
  env: Record<string, string>,
): void {
  // Auth
  if (env[envKey('AUTH_PROVIDER')]) config.auth ??= {} as CodeNexusConfig['auth'];
  if (config.auth) {
    if (env[envKey('AUTH_PROVIDER')]) config.auth.provider ??= env[envKey('AUTH_PROVIDER')]!;
    if (env[envKey('JWT_SECRET')]) config.auth.jwtSecret ??= env[envKey('JWT_SECRET')]!;
    if (env[envKey('OIDC_ISSUER')]) {
      config.auth.oidc ??= { issuer: '', clients: [] };
      config.auth.oidc.issuer ??= env[envKey('OIDC_ISSUER')]!;
    }
    if (env[envKey('OIDC_CLIENTS')]) {
      config.auth.oidc ??= { issuer: '', clients: [] };
      config.auth.oidc.clients = parseJSON(env[envKey('OIDC_CLIENTS')]!, config.auth.oidc.clients);
    }
  }

  // GitHub
  if (env[envKey('GITHUB_TOKEN')]) config.github ??= {} as CodeNexusConfig['github'];
  if (config.github) {
    if (env[envKey('GITHUB_TOKEN')]) config.github.token ??= env[envKey('GITHUB_TOKEN')]!;
    if (env[envKey('GITHUB_APP_ID')]) config.github.appId ??= env[envKey('GITHUB_APP_ID')]!;
    if (env[envKey('GITHUB_WEBHOOK_SECRET')]) config.github.webhookSecret ??= env[envKey('GITHUB_WEBHOOK_SECRET')]!;
  }

  // Agent
  if (env[envKey('AGENT_PROVIDER')] || env[envKey('AGENT_MODEL')]) {
    config.agent ??= {} as CodeNexusConfig['agent'];
  }
  if (config.agent) {
    if (env[envKey('AGENT_PROVIDER')]) config.agent.provider ??= env[envKey('AGENT_PROVIDER')]!;
    if (env[envKey('AGENT_MODEL')]) config.agent.model ??= env[envKey('AGENT_MODEL')]!;
    if (env[envKey('AGENT_LSP_ENABLED')]) config.agent.lspEnabled ??= parseBool(env[envKey('AGENT_LSP_ENABLED')], true);
    if (env[envKey('AGENT_MAX_DEPTH')]) config.agent.maxDepth ??= parseIntEnv(env[envKey('AGENT_MAX_DEPTH')], 10);
  }

  // Security
  if (env[envKey('SEC_PROMPT_INJECTION')]) config.security ??= {} as CodeNexusConfig['security'];
  if (config.security) {
    if (env[envKey('SEC_PROMPT_INJECTION')]) config.security.promptInjection ??= parseBool(env[envKey('SEC_PROMPT_INJECTION')], true);
    if (env[envKey('SEC_DATA_EXFIL')]) config.security.dataExfiltration ??= parseBool(env[envKey('SEC_DATA_EXFIL')], true);
    if (env[envKey('SEC_AGENT_MONITOR')]) config.security.agentMonitoring ??= parseBool(env[envKey('SEC_AGENT_MONITOR')], true);
  }

  // Knowledge
  if (env[envKey('KNOWLEDGE_DIR')]) config.knowledge ??= {} as CodeNexusConfig['knowledge'];
  if (config.knowledge) {
    if (env[envKey('KNOWLEDGE_DIR')]) config.knowledge.bookDirectory ??= env[envKey('KNOWLEDGE_DIR')]!;
    if (env[envKey('KNOWLEDGE_MAX_SOURCES')]) config.knowledge.maxSources ??= parseIntEnv(env[envKey('KNOWLEDGE_MAX_SOURCES')], 10);
    if (env[envKey('KNOWLEDGE_MIN_CONFIDENCE')]) config.knowledge.minConfidence ??= parseFloatEnv(env[envKey('KNOWLEDGE_MIN_CONFIDENCE')], 0.6);
  }

  // Analytics
  if (env[envKey('ANALYTICS_PROVIDER')]) config.analytics ??= {} as CodeNexusConfig['analytics'];
  if (config.analytics) {
    if (env[envKey('ANALYTICS_PROVIDER')]) config.analytics.provider ??= env[envKey('ANALYTICS_PROVIDER')]!;
    if (env[envKey('ANALYTICS_DASHBOARD_URL')]) config.analytics.dashboardUrl ??= env[envKey('ANALYTICS_DASHBOARD_URL')]!;
  }
}

/**
 * Create a typed config binding for use in Cloudflare Workers
 * that receives env bindings from the runtime.
 */
export function createConfigBinding(env: Record<string, string>): {
  load: (options?: ConfigLoadOptions) => Promise<CodeNexusConfig>;
  get: () => CodeNexusConfig;
  invalidate: () => void;
} {
  return {
    load: (options?: ConfigLoadOptions) => loadConfig(options, env),
    get: getConfig,
    invalidate: invalidateConfig,
  };
}

export default { loadConfig, getConfig, invalidateConfig, ConfigurationError, createConfigBinding };
