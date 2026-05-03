import pino from 'pino';
import type { LevelWithSilent } from 'pino';

export interface LoggerOptions {
  name?: string;
  level?: LevelWithSilent;
  serviceName?: string;
  otelEndpoint?: string;
}

let globalLogger: pino.Logger | null = null;

export function initLogger(options: LoggerOptions = {}): pino.Logger {
  const { name = 'codenexus', level = 'info', otelEndpoint } = options;

  if (globalLogger) {
    return globalLogger;
  }

  const pinoOptions: pino.LoggerOptions = {
    name,
    level,
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  };

  globalLogger = pino(pinoOptions);

  if (otelEndpoint) {
    globalLogger.info({ otelEndpoint }, 'OpenTelemetry endpoint configured (auto-instrumentation requires @opentelemetry packages)');
  }

  return globalLogger;
}

export function getLogger(name?: string): pino.Logger {
  if (!globalLogger) {
    return initLogger({ name: name ?? 'codenexus' });
  }
  return name ? globalLogger.child({ module: name }) : globalLogger;
}

export function shutdownLogger(): Promise<void> {
  return globalLogger?.flush() ?? Promise.resolve();
}

export { pino };
export type { LevelWithSilent };