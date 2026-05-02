/**
 * CodeNexus Security Module
 *
 * Fused from Claw-Protect's security framework. The SecurityManager
 * initialises all 5 detector subsystems (prompt-injection,
 * data-exfiltration, behavioral-drift, secrets-scanner, plus the
 * trust-score engine), processes incoming agent telemetry, routes
 * events to the appropriate detectors, aggregates risk scores into
 * a composite trust score, and generates security alerts.
 *
 * Also provides an Express middleware for API protection.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

import {
  TelemetryPayload,
  TelemetryEvent,
  SecurityAlert,
  Severity,
  AlertType,
  TrustScore,
} from '../../shared/src/types';

import { PromptInjectionDetector } from './detectors/prompt-injection';
import type { InjectionDetectionResult } from './detectors/prompt-injection';

import { EmbeddingInjectionDetector } from './detectors/prompt-injection-embeddings';
import type { EmbeddingResult } from './detectors/prompt-injection-embeddings';

import { DataExfiltrationDetector } from './detectors/data-exfiltration';
import type { TransferRecord, ExfiltrationResult } from './detectors/data-exfiltration';

import { BehavioralDriftDetector } from './detectors/behavioral-drift';
import type { AgentAction, DriftResult } from './detectors/behavioral-drift';

import { SecretsScanner } from './detectors/secrets-scanner';
import type { ScanResult } from './detectors/secrets-scanner';

import { TrustScoreEngine } from './trust-score';
import type { TrustFactor, TrustScoreResult } from './trust-score';

// ─── Type Exports ─────────────────────────────────────────────

export { PromptInjectionDetector } from './detectors/prompt-injection';
export type { InjectionDetectionResult, PromptInjectionConfig } from './detectors/prompt-injection';

export { DataExfiltrationDetector } from './detectors/data-exfiltration';
export type { TransferRecord, ExfiltrationResult, BaselineProfile } from './detectors/data-exfiltration';

export { BehavioralDriftDetector } from './detectors/behavioral-drift';
export type { AgentAction, DriftResult, BehaviorBaseline, DriftWindow } from './detectors/behavioral-drift';

export { SecretsScanner } from './detectors/secrets-scanner';
export type { ScanResult, SecretMatch } from './detectors/secrets-scanner';

export { TrustScoreEngine } from './trust-score';
export type { TrustFactor, TrustScoreResult, TrustScoreConfig } from './trust-score';

// ─── SecurityManager Configuration ────────────────────────────

export interface SecurityManagerConfig {
  /** Enable/disable entire security subsystem */
  enabled: boolean;
  /** Enable individual detectors */
  detectors: {
    promptInjection: boolean;
    dataExfiltration: boolean;
    behavioralDrift: boolean;
    secretsScanner: boolean;
  };
  /** Trust score alert threshold (0.0 – 1.0) */
  alertThreshold: number;
  /** Whether to apply Express middleware globally */
  enableMiddleware: boolean;
  /** Endpoint path the middleware should protect */
  middlewarePath: string;
  /** Block threshold for risk score (0.0 – 1.0, default 0.6) */
  blockThreshold?: number;
  /** Maximum body size for security inspection (bytes, default 1 MB) */
  maxBodySize?: number;
}

const DEFAULT_CONFIG: SecurityManagerConfig = {
  enabled: true,
  detectors: {
    promptInjection: true,
    dataExfiltration: true,
    behavioralDrift: true,
    secretsScanner: true,
  },
  alertThreshold: 0.4,
  enableMiddleware: true,
  middlewarePath: '/api',
};

// ─── Aggregated Security Result ───────────────────────────────

export interface SecurityAssessment {
  agentId: string;
  sessionId: string;
  trustScore: TrustScore;
  alerts: SecurityAlert[];
  injectionResult: InjectionDetectionResult | null;
  exfiltrationResult: ExfiltrationResult | null;
  driftResult: DriftResult | null;
  secretsResult: ScanResult | null;
  timestamp: string;
}

// ─── SecurityManager ──────────────────────────────────────────

export class SecurityManager {
  // ── Component Instances ─────────────────────────────────
  public readonly promptInjection: PromptInjectionDetector;
  public readonly dataExfiltration: DataExfiltrationDetector;
  public readonly behavioralDrift: BehavioralDriftDetector;
  public readonly secretsScanner: SecretsScanner;
  public readonly trustScore: TrustScoreEngine;
  private embeddingDetector: EmbeddingInjectionDetector;
  private config: SecurityManagerConfig;

  /** Alert history (ring buffer) */
  private alerts: SecurityAlert[] = [];
  private readonly maxAlerts = 10_000;

  /** Intervals for periodic maintenance */
  private decayInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<SecurityManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialise all 5 detector / scoring modules
    this.promptInjection = new PromptInjectionDetector();
    this.dataExfiltration = new DataExfiltrationDetector();
    this.behavioralDrift = new BehavioralDriftDetector();
    this.secretsScanner = new SecretsScanner();
    this.embeddingDetector = new EmbeddingInjectionDetector();
    this.trustScore = new TrustScoreEngine({
      alertThreshold: this.config.alertThreshold,
    });

    // Start periodic trust-score decay
    if (this.config.enabled) {
      this.decayInterval = setInterval(() => {
        this.trustScore.decayAll();
      }, 300_000); // every 5 minutes
    }
  }

  // ── Core Processing ─────────────────────────────────────

  /**
   * Process a full telemetry payload from an agent runtime.
   * Routes each event through the appropriate detectors,
   * aggregates scores, and returns a SecurityAssessment.
   */
  processTelemetry(payload: TelemetryPayload): SecurityAssessment {
    if (!this.config.enabled) {
      return {
        agentId: payload.agentId,
        sessionId: payload.sessionId,
        trustScore: { agentId: payload.agentId, score: 1.0, factors: {}, lastUpdated: new Date().toISOString() },
        alerts: [],
        injectionResult: null,
        exfiltrationResult: null,
        driftResult: null,
        secretsResult: null,
        timestamp: new Date().toISOString(),
      };
    }

    const alerts: SecurityAlert[] = [];

    // ── Run each detector over the payload ──
    const injectionResult = this.config.detectors.promptInjection
      ? this.runPromptInjection(payload)
      : null;

    const exfiltrationResult = this.config.detectors.dataExfiltration
      ? this.runDataExfiltration(payload)
      : null;

    const driftResult = this.config.detectors.behavioralDrift
      ? this.runBehavioralDrift(payload)
      : null;

    const secretsResult = this.config.detectors.secretsScanner
      ? this.runSecretsScan(payload)
      : null;

    // ── Aggregate risk signals into trust score factors ──
    const riskUpdates: Partial<Record<TrustFactor, number>> = {};

    if (injectionResult) {
      riskUpdates.prompt_injection_risk = injectionResult.riskScore;
      if (injectionResult.detected) {
        alerts.push(...this.buildInjectionAlerts(payload.agentId, injectionResult));
      }
    }

    if (exfiltrationResult) {
      riskUpdates.data_exfiltration_risk = exfiltrationResult.riskScore;
      if (exfiltrationResult.detected) {
        riskUpdates.session_volume_risk = Math.min(
          exfiltrationResult.bytesExfiltrated / (10 * 1024 * 1024),
          1,
        );
        alerts.push(...this.buildExfiltrationAlerts(payload.agentId, exfiltrationResult));
      }
    }

    if (driftResult) {
      riskUpdates.behavioral_drift_risk = driftResult.driftScore;
      if (driftResult.detected) {
        riskUpdates.anomaly_frequency = driftResult.driftScore;
        alerts.push(...this.buildDriftAlerts(payload.agentId, driftResult));
      }
    }

    if (secretsResult) {
      riskUpdates.secrets_leak_risk = secretsResult.riskScore;
      if (secretsResult.detected) {
        alerts.push(...this.buildSecretsAlerts(payload.agentId, secretsResult));
      }
    }

    // ── Error rate from telemetry metrics ──
    const eventErrors = payload.events.filter((e) => e.type === 'error').length;
    if (payload.events.length > 0) {
      riskUpdates.error_rate = eventErrors / payload.events.length;
    }

    // ── Update trust score ──
    const trustResult = this.trustScore.updateScore(payload.agentId, riskUpdates);

    // ── Generate trust-score alert if threshold breached ──
    if (trustResult.alertTriggered) {
      alerts.push(this.buildTrustAlert(payload.agentId, trustResult));
    }

    // ── Store alerts ──
    for (const alert of alerts) {
      this.alerts.push(alert);
      if (this.alerts.length > this.maxAlerts) {
        this.alerts.shift();
      }
    }

    const trustScore = this.trustScore.getScore(payload.agentId) ?? {
      agentId: payload.agentId,
      score: 0.8,
      factors: {},
      lastUpdated: new Date().toISOString(),
    };

    return {
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      trustScore,
      alerts,
      injectionResult,
      exfiltrationResult,
      driftResult,
      secretsResult,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Process a single telemetry event (lightweight — for streaming
   * or real-time pipelines).
   */
  processEvent(
    agentId: string,
    sessionId: string,
    event: TelemetryEvent,
  ): SecurityAssessment {
    const telemetry: TelemetryPayload = {
      agentId,
      sessionId,
      timestamp: event.timestamp,
      events: [event],
      metrics: { cpu: 0, memory: 0, networkOutbound: 0, processCount: 0 },
    };
    return this.processTelemetry(telemetry);
  }

  // ── Express Middleware ──────────────────────────────────

  /**
   * Returns an Express middleware that intercepts requests on the
   * configured path prefix and runs a light security assessment
   * on the request body / headers / query parameters.
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!this.config.enabled || !this.config.enableMiddleware) {
        next();
        return;
      }

      if (!req.path.startsWith(this.config.middlewarePath)) {
        next();
        return;
      }

      // Build a synthetic payload from request data
      const MAX_BODY = this.config.maxBodySize ?? 1048576; // 1 MB default
      const bodyStr = JSON.stringify({ body: req.body, query: req.query });
      if (bodyStr.length > MAX_BODY) {
        res.status(413).json({
          error: 'Payload too large for security inspection',
          code: 'PAYLOAD_TOO_LARGE',
        });
        return;
      }

      const input = JSON.stringify({
        body: req.body,
        query: req.query,
        headers: this.sanitizeHeaders(req.headers),
        url: req.originalUrl,
        method: req.method,
      });

      // Run injection + secrets checks on request content
      const injectionResult = this.promptInjection.analyze(input);
      const embeddingResult = this.embeddingDetector.analyze(input);
      const secretsResult = this.secretsScanner.scan(input);

      if (injectionResult.detected || embeddingResult.detected || secretsResult.detected) {
        const riskScore = Math.max(
          injectionResult.riskScore,
          embeddingResult.riskScore,
          secretsResult.riskScore,
        );

        // Block requests above threshold
        const blockThreshold = this.config.blockThreshold ?? 0.6;
        if (riskScore > blockThreshold) {
          res.status(403).json({
            error: 'Request blocked by security policy',
            code: 'SECURITY_BLOCK',
            severity: injectionResult.maxSeverity,
          });
          return;
        }
      }

      next();
    };
  }

  // ── Alert Management ────────────────────────────────────

  /**
   * Retrieve all alerts, optionally filtered by severity and type.
   */
  getAlerts(filters?: {
    severity?: Severity;
    type?: AlertType;
    agentId?: string;
    since?: string;
  }): SecurityAlert[] {
    let filtered = [...this.alerts];

    if (filters?.severity) {
      filtered = filtered.filter((a) => a.severity === filters.severity);
    }
    if (filters?.type) {
      filtered = filtered.filter((a) => a.type === filters.type);
    }
    if (filters?.agentId) {
      filtered = filtered.filter((a) => a.agentId === filters.agentId);
    }
    if (filters?.since) {
      const sinceTime = new Date(filters.since).getTime();
      filtered = filtered.filter(
        (a) => new Date(a.timestamp).getTime() > sinceTime,
      );
    }

    return filtered.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /**
   * Get a summary of security stats.
   */
  getStats(): SecurityStats {
    const alerts = this.alerts;
    return {
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter((a) => a.severity === Severity.Critical).length,
      highAlerts: alerts.filter((a) => a.severity === Severity.High).length,
      mediumAlerts: alerts.filter((a) => a.severity === Severity.Medium).length,
      lowAlerts: alerts.filter((a) => a.severity === Severity.Low).length,
      byType: this.countByType(alerts),
      activeAgentCount: this.trustScore.getAllScores().size,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Gracefully shut down — clears timers and resets state.
   */
  shutdown(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  /**
   * Reset all security state for a given agent.
   */
  resetAgent(agentId: string): void {
    this.trustScore.resetAgent(agentId);
    this.behavioralDrift.resetAgent(agentId);
    // Remove agent's alerts
    this.alerts = this.alerts.filter((a) => a.agentId !== agentId);
  }

  /**
   * Reset all security state.
   */
  resetAll(): void {
    this.alerts = [];
    this.trustScore.decayAll();
  }

  // ── Private Detector Routers ────────────────────────────

  private runPromptInjection(payload: TelemetryPayload): InjectionDetectionResult {
    // Concatenate all event inputs and outputs for scanning
    const combinedText = payload.events
      .map((e) => `${e.input}\n${e.output}`)
      .join('\n---\n');

    return this.promptInjection.analyze(combinedText);
  }

  private runDataExfiltration(payload: TelemetryPayload): ExfiltrationResult {
    // Infer transfer records from telemetry events
    const records: TransferRecord[] = [];

    for (const event of payload.events) {
      for (const call of event.toolCalls) {
        // Only analyse tools that make external calls
        if (this.isNetworkTool(call.toolName)) {
          const resultStr = typeof call.result === 'string' ? call.result : JSON.stringify(call.result);
          records.push({
            sessionId: payload.sessionId,
            agentId: payload.agentId,
            destination: this.extractDestination(call),
            port: null,
            payload: resultStr.substring(0, 10_000),
            sizeBytes: resultStr.length,
            protocol: this.inferProtocol(call.toolName),
            timestamp: call.timestamp,
          });
        }
      }
    }

    if (records.length === 0) {
      // Still check payload metrics
      const networkOutbound = payload.metrics.networkOutbound;
      return {
        detected: false,
        riskScore: 0,
        reasons: [],
        matchedSensitiveData: [],
        anomalousIndicators: [],
        bytesExfiltrated: networkOutbound,
      };
    }

    // Batch-analyse all records
    const batchResults = this.dataExfiltration.analyzeBatch(records);
    const results = Array.from(batchResults.values());

    // Aggregate
    const detected = results.some((r) => r.detected);
    const maxScore = Math.max(...results.map((r) => r.riskScore), 0);
    const totalBytes = results.reduce((s, r) => s + r.bytesExfiltrated, 0);

    return {
      detected,
      riskScore: maxScore,
      reasons: [...new Set(results.flatMap((r) => r.reasons))],
      matchedSensitiveData: results.flatMap((r) => r.matchedSensitiveData),
      anomalousIndicators: results.flatMap((r) => r.anomalousIndicators),
      bytesExfiltrated: totalBytes,
    };
  }

  private runBehavioralDrift(payload: TelemetryPayload): DriftResult {
    let aggregate: DriftResult | null = null;

    for (const event of payload.events) {
      for (const call of event.toolCalls) {
        const action: AgentAction = {
          agentId: payload.agentId,
          sessionId: payload.sessionId,
          timestamp: call.timestamp,
          toolName: call.toolName,
          durationMs: event.duration,
          inputTokens: this.estimateTokens(event.input),
          outputTokens: this.estimateTokens(event.output),
          success: call.result !== undefined && !String(call.result).startsWith('Error'),
          error: String(call.result).startsWith('Error') ? call.result.substring(0, 200) : undefined,
        };

        const result = this.behavioralDrift.recordAndAnalyze(action);
        if (!aggregate || result.driftScore > aggregate.driftScore) {
          aggregate = result;
        }
      }
    }

    return aggregate ?? {
      detected: false,
      driftScore: 0,
      anomalousMetrics: [],
      severity: Severity.Info,
    };
  }

  private runSecretsScan(payload: TelemetryPayload): ScanResult {
    const textsToScan: string[] = [];

    for (const event of payload.events) {
      textsToScan.push(event.input);
      textsToScan.push(event.output);

      for (const call of event.toolCalls) {
        textsToScan.push(JSON.stringify(call.arguments));
        textsToScan.push(
          typeof call.result === 'string' ? call.result : JSON.stringify(call.result),
        );
      }
    }

    const batchResults = this.secretsScanner.scanBatch(textsToScan);
    const results = Array.from(batchResults.values());

    const detected = results.some((r) => r.detected);
    const maxScore = Math.max(...results.map((r) => r.riskScore), 0);
    const totalSecrets = results.reduce((s, r) => s + r.totalSecrets, 0);
    const criticalSecrets = results.reduce((s, r) => s + r.criticalSecrets, 0);
    const highSecrets = results.reduce((s, r) => s + r.highSecrets, 0);

    return {
      detected,
      secrets: results.flatMap((r) => r.secrets),
      riskScore: maxScore,
      totalSecrets,
      criticalSecrets,
      highSecrets,
    };
  }

  // ── Alert Builders ──────────────────────────────────────

  private buildInjectionAlerts(agentId: string, result: InjectionDetectionResult): SecurityAlert[] {
    return result.matchedPatterns.map((p) => ({
      id: uuidv4(),
      severity: p.severity,
      type: 'prompt_injection' as AlertType,
      description: `Prompt injection detected: ${p.description}`,
      agentId,
      details: {
        patternId: p.patternId,
        category: p.category,
        match: p.match,
        riskScore: result.riskScore,
      },
      timestamp: new Date().toISOString(),
    }));
  }

  private buildExfiltrationAlerts(agentId: string, result: ExfiltrationResult): SecurityAlert[] {
    const alert: SecurityAlert = {
      id: uuidv4(),
      severity: Severity.High,
      type: 'data_exfiltration' as AlertType,
      description: `Data exfiltration detected: ${result.reasons.join(', ')}`,
      agentId,
      details: {
        reasons: result.reasons,
        bytesExfiltrated: result.bytesExfiltrated,
        sensitiveDataCount: result.matchedSensitiveData.length,
        riskScore: result.riskScore,
      },
      timestamp: new Date().toISOString(),
    };

    if (result.matchedSensitiveData.some((m) => m.severity === Severity.Critical)) {
      alert.severity = Severity.Critical;
    }

    return [alert];
  }

  private buildDriftAlerts(agentId: string, result: DriftResult): SecurityAlert[] {
    return [
      {
        id: uuidv4(),
        severity: result.severity,
        type: 'behavioral_drift' as AlertType,
        description: `Behavioral drift detected (score: ${result.driftScore.toFixed(2)})`,
        agentId,
        details: {
          driftScore: result.driftScore,
          anomalousMetrics: result.anomalousMetrics.map((m) => ({
            metric: m.metricName,
            tool: m.toolName,
            zScore: m.deviationZScore,
          })),
        },
        timestamp: new Date().toISOString(),
      },
    ];
  }

  private buildSecretsAlerts(agentId: string, result: ScanResult): SecurityAlert[] {
    if (result.criticalSecrets > 0) {
      return [
        {
          id: uuidv4(),
          severity: Severity.Critical,
          type: 'secrets_leak' as AlertType,
          description: `Critical secrets leaked in agent output (${result.criticalSecrets} critical, ${result.highSecrets} high)`,
          agentId,
          details: {
            totalSecrets: result.totalSecrets,
            criticalSecrets: result.criticalSecrets,
            highSecrets: result.highSecrets,
            topMatches: result.secrets.slice(0, 5).map((s) => ({
              pattern: s.patternName,
              severity: s.severity,
              position: s.position,
            })),
          },
          timestamp: new Date().toISOString(),
        },
      ];
    }

    if (result.highSecrets > 0) {
      return [
        {
          id: uuidv4(),
          severity: Severity.High,
          type: 'secrets_leak' as AlertType,
          description: `High-severity secrets detected (${result.highSecrets} high)`,
          agentId,
          details: {
            totalSecrets: result.totalSecrets,
            highSecrets: result.highSecrets,
            topMatches: result.secrets.slice(0, 3).map((s) => ({
              pattern: s.patternName,
              severity: s.severity,
            })),
          },
          timestamp: new Date().toISOString(),
        },
      ];
    }

    return [
      {
        id: uuidv4(),
        severity: Severity.Medium,
        type: 'secrets_leak' as AlertType,
        description: `Potential secrets detected in agent output (${result.totalSecrets} matches)`,
        agentId,
        details: {
          totalSecrets: result.totalSecrets,
          riskScore: result.riskScore,
        },
        timestamp: new Date().toISOString(),
      },
    ];
  }

  private buildTrustAlert(agentId: string, result: TrustScoreResult): SecurityAlert {
    return {
      id: uuidv4(),
      severity: TrustScoreEngine.severityFromScore(result.newScore),
      type: 'permission_violation' as AlertType,
      description: `Agent trust score dropped below threshold: ${result.newScore.toFixed(2)} (was ${result.previousScore.toFixed(2)})`,
      agentId,
      details: {
        previousScore: result.previousScore,
        newScore: result.newScore,
        impacts: result.impacts.map((i) => ({
          factor: i.factor,
          delta: i.delta,
          contribution: i.contribution,
        })),
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private isNetworkTool(toolName: string): boolean {
    const networkTools = [
      'fetch', 'http_get', 'http_post', 'curl', 'wget',
      'request', 'axios', 'api_call', 'graphql_query',
      'webhook', 'post', 'put', 'patch', 'delete',
    ];
    return networkTools.some((t) => toolName.toLowerCase().includes(t));
  }

  private extractDestination(call: { toolName: string; arguments: Record<string, unknown> }): string {
    const args = call.arguments;
    const url =
      (args.url as string) ??
      (args.endpoint as string) ??
      (args.host as string) ??
      (args.domain as string) ??
      'unknown';

    try {
      return new URL(url).hostname;
    } catch {
      return String(url);
    }
  }

  private inferProtocol(toolName: string): string {
    const lower = toolName.toLowerCase();
    if (lower.includes('http') || lower.includes('fetch') || lower.includes('axios')) return 'https';
    if (lower.includes('ws')) return 'websocket';
    if (lower.includes('dns')) return 'dns';
    return 'unknown';
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil((text?.length ?? 0) / 4);
  }

  private sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveHeaders = new Set([
      'authorization', 'cookie', 'set-cookie', 'x-api-key',
      'x-auth-token', 'proxy-authorization',
    ]);
    for (const [key, value] of Object.entries(headers)) {
      sanitized[key] = sensitiveHeaders.has(key.toLowerCase()) ? '[REDACTED]' : value;
    }
    return sanitized;
  }

  private countByType(alerts: SecurityAlert[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const a of alerts) {
      counts[a.type] = (counts[a.type] || 0) + 1;
    }
    return counts;
  }
}

// ─── Stats Interface ──────────────────────────────────────────

export interface SecurityStats {
  totalAlerts: number;
  criticalAlerts: number;
  highAlerts: number;
  mediumAlerts: number;
  lowAlerts: number;
  byType: Record<string, number>;
  activeAgentCount: number;
}
