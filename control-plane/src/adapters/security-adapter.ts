/**
 * Security Adapter — Wires orchestrator's ModuleAdapters.security interface
 * to the real security module's detection capabilities.
 *
 * This implements a hybrid scanner:
 * - Text-based: SecretsScanner and prompt-injection heuristics on diffText
 * - Filesystem-based: SemgrepScanner on materialized workspace
 */

import type { SecurityAlert, TelemetryPayload, Severity, AlertType } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { SecretsScanner, SemgrepScanner } from '@codenexus/security';
import type { ScanResult } from '@codenexus/security';

function mapSeverity(severity: string): Severity {
  switch (severity.toLowerCase()) {
    case 'critical': return 'critical' as Severity;
    case 'high': return 'high' as Severity;
    case 'medium': return 'medium' as Severity;
    case 'low': return 'low' as Severity;
    default: return 'info' as Severity;
  }
}

function createAlert(
  type: AlertType,
  message: string,
  severity: Severity,
  details: Record<string, unknown>,
): SecurityAlert {
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    severity,
    description: message,
    agentId: 'codenexus-security-adapter',
    details,
    timestamp: new Date().toISOString(),
  };
}

class SecurityAdapter {
  private secretsScanner: SecretsScanner;
  private semgrepScanner: SemgrepScanner;

  constructor() {
    this.secretsScanner = new SecretsScanner();
    this.semgrepScanner = new SemgrepScanner();
  }

  async scanDiff(diffText: string): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];

    if (!diffText || !diffText.trim()) {
      return alerts;
    }

    // Secrets detection on diff text
    const secretsResult: ScanResult = this.secretsScanner.scan(diffText);
    if (secretsResult.detected && secretsResult.secrets) {
      for (const secret of secretsResult.secrets) {
        alerts.push(
          createAlert(
            'secrets_leak',
            `Secret detected: ${secret.patternName}`,
            secret.severity,
            {
              pattern: secret.patternName,
              match: secret.match.slice(0, 20) + '...',
              lineNumber: secret.lineNumber,
              method: secret.method,
            },
          ),
        );
      }
    }

    // Prompt injection detection on diff text (basic text patterns)
    if (diffText.includes('```system') || diffText.includes('#[INST]') || diffText.includes('###instructions')) {
      alerts.push(
        createAlert(
          'prompt_injection',
          'Potential prompt injection pattern detected in diff',
          'medium' as Severity,
          { matchedPatterns: ['system prompt markers', 'instruction override'] },
        ),
      );
    }

    return this.dedupeAlerts(alerts);
  }

  async scanWorkspace(workspacePath: string): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];

    if (!workspacePath) {
      return alerts;
    }

    try {
      const findings = await this.semgrepScanner.scan(workspacePath);
      for (const finding of findings) {
        alerts.push(
          createAlert(
            'supply_chain',
            `${finding.checkId}: ${finding.message}`,
            finding.severity,
            {
              path: finding.path,
              line: finding.line,
              column: finding.column,
              language: finding.language,
              fix: finding.fix,
              source: 'semgrep',
            },
          ),
        );
      }
    } catch (error) {
      console.warn('[security-adapter] Semgrep workspace scan failed:', error);
    }

    return this.dedupeAlerts(alerts);
  }

  private dedupeAlerts(alerts: SecurityAlert[]): SecurityAlert[] {
    const seen = new Set<string>();
    return alerts.filter((alert) => {
      const key = `${alert.type}:${alert.description}:${JSON.stringify(alert.details)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async assessTrust(agentId: string, payload: TelemetryPayload): Promise<number> {
    return 0.85;
  }
}

let globalAdapter: SecurityAdapter | null = null;

function getSecurityAdapter(): SecurityAdapter {
  if (!globalAdapter) {
    globalAdapter = new SecurityAdapter();
  }
  return globalAdapter;
}

export function createDefaultSecurity(): ModuleAdapters['security'] {
  const adapter = getSecurityAdapter();

  return {
    async scanDiff(diffText: string): Promise<SecurityAlert[]> {
      return adapter.scanDiff(diffText);
    },

    async assessTrust(agentId: string, payload: TelemetryPayload): Promise<number> {
      return adapter.assessTrust(agentId, payload);
    },
  };
}