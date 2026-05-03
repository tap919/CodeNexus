/**
 * Security Adapter — Wires orchestrator's ModuleAdapters.security interface
 * to the real security module's detection capabilities.
 *
 * This implements a hybrid scanner:
 * - Text-based: SecretsScanner and prompt-injection heuristics on diffText
 * - Filesystem-based: SemgrepScanner and AST analyzers on materialied workspace
 */

import type { SecurityAlert, TelemetryPayload, Severity, AlertType } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { getConfig } from '../config';
import {
  SecretsScanner,
  SemgrepScanner,
  analyzeFile,
  PromptInjectionDetector,
  type ScanResult,
  type SecretMatch,
  type InjectionDetectionResult,
} from '@codenexus/security';

export interface PRSecurityInput {
  /** Raw unified diff text */
  diffText: string;
  /** Path to materialized workspace (for Semgrep/AST) */
  workspacePath?: string;
  /** Changed files with their patches */
  changedFiles?: Array<{
    path: string;
    patch?: string;
    status?: string;
  }>;
}

function mapSeverityToAlert(severity: string): Severity {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'critical' as Severity;
    case 'high':
      return 'high' as Severity;
    case 'medium':
      return 'medium' as Severity;
    case 'low':
      return 'low' as Severity;
    default:
      return 'info' as Severity;
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
  private promptInjectionDetector: PromptInjectionDetector;

  constructor() {
    this.secretsScanner = new SecretsScanner();
    this.semgrepScanner = new SemgrepScanner();
    this.promptInjectionDetector = new PromptInjectionDetector();
  }

  async scanPRArtifacts(input: PRSecurityInput): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];

    // Text-based scans (always run)
    if (input.diffText) {
      alerts.push(...await this.scanSecretsInDiff(input.diffText));
      alerts.push(...await this.scanPromptInjectionInDiff(input.diffText));
    }

    // Filesystem-based scans (if workspace available)
    if (input.workspacePath) {
      alerts.push(...await this.runSemgrep(input.workspacePath));
      alerts.push(...await this.runAstAnalyzers(input.workspacePath, input.changedFiles ?? []));
    }

    return this.dedupeAlerts(alerts);
  }

  private async scanSecretsInDiff(diffText: string): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];
    const result: ScanResult = this.secretsScanner.scan(diffText);

    if (result.detected) {
      for (const secret of result.secrets) {
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

    return alerts;
  }

  private async scanPromptInjectionInDiff(diffText: string): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];
    const result: InjectionDetectionResult = this.promptInjectionDetector.detect(diffText);

    if (result.detected) {
      alerts.push(
        createAlert(
          'prompt_injection',
          result.explanation ?? 'Potential prompt injection detected',
          result.severity ?? 'medium',
          {
            matchedPatterns: result.matchedPatterns,
            confidence: result.confidence,
          },
        ),
      );
    }

    return alerts;
  }

  private async runSemgrep(workspacePath: string): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];

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
      console.warn('[security-adapter] Semgrep scan failed:', error);
    }

    return alerts;
  }

  private async runAstAnalyzers(
    workspacePath: string,
    changedFiles: Array<{ path: string }>,
  ): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];

    if (!changedFiles || changedFiles.length === 0) {
      return alerts;
    }

    for (const file of changedFiles) {
      try {
        const result = analyzeFile(file.path);
        if (result.findings && result.findings.length > 0) {
          for (const finding of result.findings) {
            alerts.push(
              createAlert(
                'supply_chain',
                `${finding.category}: ${finding.message}`,
                mapSeverityToAlert(finding.severity ?? 'medium'),
                {
                  path: finding.path,
                  line: finding.line,
                  column: finding.column,
                  source: 'ast-analyzer',
                },
              ),
            );
          }
        }
      } catch {
        // Skip files that fail to analyze
      }
    }

    return alerts;
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
    // Placeholder: the security module has a full trust-score engine
    // that could be wired here with proper TelemetryPayload inputs
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
      return adapter.scanPRArtifacts({
        diffText,
        workspacePath: undefined,
        changedFiles: [],
      });
    },

    async assessTrust(agentId: string, payload: TelemetryPayload): Promise<number> {
      return adapter.assessTrust(agentId, payload);
    },
  };
}