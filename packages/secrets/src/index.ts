import pino from 'pino';

const logger = pino({ name: 'secrets' });

export interface SecretConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: 'global' | 'environment' | 'project';
  environment?: string;
}

export interface SecretResult {
  key: string;
  value: string;
  version?: number;
  updatedAt?: Date;
}

let secretsClient: unknown = null;
let initialized = false;

export async function initSecrets(config: SecretConfig): Promise<void> {
  if (initialized) {
    return;
  }

  const infisicalPath = await import('infisical-node').catch(() => null);
  
  if (infisicalPath) {
    try {
      const { createClient } = infisicalPath;
      const { clientId = process.env.INFISICAL_CLIENT_ID, clientSecret = process.env.INFISICAL_CLIENT_SECRET } = config;
      
      if (clientId && clientSecret) {
        secretsClient = createClient({
          clientId,
          clientSecret,
          scope: config.scope ?? 'global',
          environment: config.environment ?? 'dev',
        });
        logger.info({ scope: config.scope }, 'Infisical client initialized');
        initialized = true;
        return;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize Infisical, falling back to env vars');
    }
  }

  logger.info('Using environment variable fallback for secrets');
  initialized = true;
}

export async function getSecret(key: string): Promise<string | null> {
  if (secretsClient) {
    try {
      const secret = await (secretsClient as { secrets: { getSecret: (key: string) => Promise<{ secret: SecretResult }> } }).secrets.getSecret(key);
      return secret?.secret?.value ?? null;
    } catch {
      // Fall through to env vars
    }
  }

  return process.env[key] ?? null;
}

export async function getSecrets(prefix?: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(process.env)) {
    if (prefix ? key.startsWith(prefix) : key) {
      result[key] = value ?? '';
    }
  }
  
  return result;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (secretsClient) {
    try {
      await (secretsClient as { secrets: { setSecret: (params: { key: string; value: string }) => Promise<void> } }).secrets.setSecret({ key, value });
      return;
    } catch {
      // Fall through
    }
  }
  
  throw new Error('Cannot set secret: No secrets client configured');
}

export function isSecretsInitialized(): boolean {
  return initialized;
}

export async function closeSecrets(): Promise<void> {
  if (secretsClient) {
    await (secretsClient as { close: () => Promise<void> })?.close()?.catch(() => {});
    secretsClient = null;
  }
  initialized = false;
}