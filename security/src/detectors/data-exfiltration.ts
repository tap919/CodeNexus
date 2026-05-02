/**
 * Data Exfiltration Monitor
 *
 * Tracks outbound network transfers from agent sessions, detects
 * sensitive data patterns (API keys, tokens, PII), and enforces
 * per-session transfer limits. Uses baseline statistics for
 * anomaly detection.
 *
 * Fused from Claw-Protect's egress monitoring subsystem.
 */

import { Severity } from '../../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────

export interface TransferRecord {
  /** Session that originated the transfer */
  sessionId: string;
  /** Agent identifier */
  agentId: string;
  /** Destination host / IP */
  destination: string;
  /** Port (if known) */
  port: number | null;
  /** Payload being transferred (truncated) */
  payload: string;
  /** Payload size in bytes */
  sizeBytes: number;
  /** Protocol (http, dns, websocket, etc.) */
  protocol: string;
  /** Timestamp of the event */
  timestamp: string;
}

export interface ExfiltrationResult {
  detected: boolean;
  riskScore: number; // 0.0 – 1.0
  reasons: ReasonCode[];
  matchedSensitiveData: SensitiveDataMatch[];
  anomalousIndicators: AnomalyIndicator[];
  bytesExfiltrated: number;
}

export type ReasonCode =
  | 'high_volume_outbound'
  | 'sensitive_data_detected'
  | 'unusual_destination'
  | 'baseline_deviation'
  | 'session_limit_exceeded'
  | 'protocol_anomaly';

export interface SensitiveDataMatch {
  patternName: string;
  severity: Severity;
  match: string;
}

export interface AnomalyIndicator {
  metric: string;
  observedValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationZScore: number;
}

// ─── Sensitive Data Patterns ──────────────────────────────────

interface SensitivePattern {
  name: string;
  regex: RegExp;
  severity: Severity;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // Generic API key patterns
  { name: 'Generic API Key', regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/i, severity: Severity.High },
  { name: 'Authorization Bearer Token', regex: /(?:Bearer\s+)[A-Za-z0-9_\-=.]{20,}/, severity: Severity.Critical },
  { name: 'Basic Auth Credential', regex: /(?:Basic\s+)[A-Za-z0-9+/=]{10,}/, severity: Severity.Critical },

  // AWS
  { name: 'AWS Access Key ID', regex: /(?:AKIA[0-9A-Z]{16})/, severity: Severity.High },
  { name: 'AWS Secret Access Key', regex: /(?:['"]?(?:(?i)aws[_-]?(?:secret|access)[_-]?key|secret[_-]?access[_-]?key)['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?)/, severity: Severity.Critical },

  // GitHub
  { name: 'GitHub Personal Access Token', regex: /(?:ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z]{22,})/, severity: Severity.Critical },
  { name: 'GitHub OAuth Token', regex: /(?:gho_[0-9a-zA-Z]{36})/, severity: Severity.Critical },
  { name: 'GitHub App Token', regex: /(?:ghs_[0-9a-zA-Z]{36})/, severity: Severity.Critical },
  { name: 'GitHub Refresh Token', regex: /(?:ghr_[0-9a-zA-Z]{36})/, severity: Severity.Critical },

  // Google / GCP
  { name: 'Google API Key', regex: /(?:AIza[0-9A-Za-z\-_]{35})/, severity: Severity.High },
  { name: 'GCP Service Account Key', regex: /(?:["']?type["']?\s*:\s*["']service_account["']?)/, severity: Severity.Critical },

  // Slack
  { name: 'Slack Bot Token', regex: /(?:xoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24})/, severity: Severity.Critical },
  { name: 'Slack Webhook URL', regex: /(?:hooks\.slack\.com\/services\/[A-Za-z0-9/]{44})/, severity: Severity.High },
  { name: 'Slack User Token', regex: /(?:xoxp-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{32})/, severity: Severity.High },

  // Stripe
  { name: 'Stripe Live Secret Key', regex: /(?:sk_live_[0-9a-zA-Z]{24,})/, severity: Severity.Critical },
  { name: 'Stripe Live Publishable Key', regex: /(?:pk_live_[0-9a-zA-Z]{24,})/, severity: Severity.Medium },
  { name: 'Stripe Test Secret Key', regex: /(?:sk_test_[0-9a-zA-Z]{24,})/, severity: Severity.Medium },

  // PII: Email
  { name: 'Email Address', regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, severity: Severity.Low },
  // PII: Phone (US-centric, extensible)
  { name: 'Phone Number', regex: /\b(?:\+?1[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/, severity: Severity.Low },
  // PII: SSN
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/, severity: Severity.High },
  // PII: Credit Card
  { name: 'Credit Card Number (Luhn-validable)', regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/, severity: Severity.High },

  // JWT
  { name: 'JWT Token', regex: /(?:eyJ[A-Za-z0-9_\-=]+\.eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-+/=]+)/, severity: Severity.High },

  // Docker
  { name: 'Docker Config Auth', regex: /(?:["']auth["']\s*:\s*["'][A-Za-z0-9+/=]{20,}["'])/, severity: Severity.Medium },

  // npm / .npmrc
  { name: 'npm Auth Token', regex: /(?:\/\/registry\.npmjs\.org\/:_authToken=[A-Za-z0-9\-]{36})/, severity: Severity.High },

  // Private Key (RSA, DSA, EC, Ed25519)
  { name: 'Private Key (PEM)', regex: /(?:-----BEGIN\s+(?:RSA|DSA|EC|PRIVATE|OPENSSH)\s+PRIVATE\s+KEY-----)/, severity: Severity.Critical },

  // Generic hex-encoded high-entropy secret
  { name: 'Generic Hex Secret (≥ 32 hex chars)', regex: /\b[0-9a-fA-F]{32,}\b/, severity: Severity.Low },

  // Discord bot token
  { name: 'Discord Bot Token', regex: /(?:[MN][A-Za-z\d]{23}\.[Xx][A-Za-z\d]{6}\.[A-Za-z\d]{27})/, severity: Severity.High },

  // Telegram bot token
  { name: 'Telegram Bot Token', regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, severity: Severity.High },

  // OpenAI API key
  { name: 'OpenAI API Key', regex: /(?:sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})/, severity: Severity.Critical },

  // Azure / MS
  { name: 'Azure Connection String', regex: /(?:DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+;)/, severity: Severity.Critical },
  { name: 'Azure DevOps PAT', regex: /(?:PAT=["']?[a-z0-9]{52}["']?)/i, severity: Severity.High },

  // Heroku
  { name: 'Heroku API Key', regex: /(?:[hH][eE][rR][oO][kK][uU].*[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/, severity: Severity.High },
];

// ─── Session Transfer Tracker ─────────────────────────────────

interface SessionTransferState {
  bytesTotal: number;
  bytesByDestination: Map<string, number>;
  lastEvent: string;
}

// ─── Baseline Profile ─────────────────────────────────────────

export interface BaselineProfile {
  /** Mean bytes per event for this agent */
  meanBytesPerEvent: number;
  /** Standard deviation of bytes per event */
  stddevBytesPerEvent: number;
  /** Mean calls per session */
  meanCallsPerSession: number;
  /** Known destinations (host set) */
  knownDestinations: Set<string>;
  /** Number of data points used to build this baseline */
  sampleCount: number;
}

// ─── Configuration ────────────────────────────────────────────

export interface DataExfiltrationConfig {
  /** Per-session transfer limit in bytes */
  sessionByteLimit: number;
  /** Z-score threshold for anomaly flagging */
  anomalyZScoreThreshold: number;
  /** Minimum severity level for sensitive data alerts */
  minSensitiveSeverity: Severity;
  /** Enable outbound volume tracking */
  enableVolumeTracking: boolean;
  /** Enable sensitive data pattern scanning */
  enablePatternScanning: boolean;
  /** Enable baseline deviation detection */
  enableAnomalyDetection: boolean;
  /** Known safe destinations that won't trigger alerts */
  safeDestinations: string[];
}

const DEFAULT_CONFIG: DataExfiltrationConfig = {
  sessionByteLimit: 10 * 1024 * 1024, // 10 MB
  anomalyZScoreThreshold: 3.0,
  minSensitiveSeverity: Severity.Medium,
  enableVolumeTracking: true,
  enablePatternScanning: true,
  enableAnomalyDetection: true,
  safeDestinations: [
    'api.github.com',
    'api.openai.com',
    'api.anthropic.com',
    'registry.npmjs.org',
    'auth.docker.io',
  ],
};

// ─── Detector Class ───────────────────────────────────────────

export class DataExfiltrationDetector {
  private config: DataExfiltrationConfig;

  /** Session-scoped byte counters */
  private sessions: Map<string, SessionTransferState> = new Map();

  /** Current baseline profile, rebuilt periodically */
  private baseline: BaselineProfile | null = null;

  /** Rolling history for baseline computation (ring buffer) */
  private history: Array<{ agentId: string; bytes: number; calls: number; destination: string }> = [];

  private readonly maxHistory = 10_000;

  constructor(config: Partial<DataExfiltrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Analyse a single outbound transfer record.
   */
  analyze(record: TransferRecord): ExfiltrationResult {
    const reasons: ReasonCode[] = [];
    const matchedSensitiveData: SensitiveDataMatch[] = [];
    const anomalousIndicators: AnomalyIndicator[] = [];

    // ── Track session volume ──
    let bytesTotalInSession = 0;
    if (this.config.enableVolumeTracking) {
      bytesTotalInSession = this.trackSessionVolume(record);
      if (bytesTotalInSession > this.config.sessionByteLimit) {
        reasons.push('session_limit_exceeded');
      }

      if (record.sizeBytes > 10 * 1024 * 1024) {
        reasons.push('high_volume_outbound');
      }
    }

    // ── Scan payload for sensitive data ──
    if (this.config.enablePatternScanning) {
      const matches = this.scanPayload(record.payload, record.destination);
      matchedSensitiveData.push(...matches);
      if (matches.length > 0) {
        reasons.push('sensitive_data_detected');
      }
    }

    // ── Check destination reputation ──
    if (
      !this.config.safeDestinations.some((d) => record.destination.includes(d))
    ) {
      reasons.push('unusual_destination');
    }

    // ── Baseline deviation ──
    if (this.config.enableAnomalyDetection && this.baseline) {
      const anomaly = this.checkBaselineDeviation(record);
      if (anomaly) {
        anomalousIndicators.push(anomaly);
        reasons.push('baseline_deviation');
      }
    }

    // ── Record to history for future baselines ──
    this.recordHistory(record);

    // ── Aggregate score ──
    const riskScore = this.calculateRiskScore(reasons, matchedSensitiveData, anomalousIndicators);

    return {
      detected:
        reasons.length > 0 ||
        matchedSensitiveData.length > 0 ||
        anomalousIndicators.length > 0,
      riskScore,
      reasons,
      matchedSensitiveData,
      anomalousIndicators,
      bytesExfiltrated: record.sizeBytes,
    };
  }

  /**
   * Analyse a batch of transfer records in one pass.
   */
  analyzeBatch(records: TransferRecord[]): Map<string, ExfiltrationResult> {
    const results = new Map<string, ExfiltrationResult>();
    for (const record of records) {
      results.set(`${record.sessionId}:${record.timestamp}`, this.analyze(record));
    }
    return results;
  }

  /**
   * (Re)build the baseline profile from the collected history.
   */
  rebuildBaseline(): BaselineProfile | null {
    if (this.history.length < 10) return null;

    const agentGroups = new Map<string, number[]>();
    const destSet = new Set<string>();

    for (const entry of this.history) {
      const arr = agentGroups.get(entry.agentId) || [];
      arr.push(entry.bytes);
      agentGroups.set(entry.agentId, arr);
      destSet.add(entry.destination);
    }

    const allBytes: number[] = [];
    for (const bytes of agentGroups.values()) {
      allBytes.push(...bytes);
    }

    const mean = this.mean(allBytes);
    const stddev = this.stddev(allBytes, mean);

    this.baseline = {
      meanBytesPerEvent: mean,
      stddevBytesPerEvent: stddev,
      meanCallsPerSession: this.history.length / agentGroups.size,
      knownDestinations: destSet,
      sampleCount: this.history.length,
    };

    return this.baseline;
  }

  getBaseline(): Readonly<BaselineProfile> | null {
    return this.baseline ? { ...this.baseline, knownDestinations: new Set(this.baseline.knownDestinations) } : null;
  }

  /** Reset per-session counters (e.g., on session end). */
  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  updateConfig(partial: Partial<DataExfiltrationConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ── Private ──────────────────────────────────────────────

  private trackSessionVolume(record: TransferRecord): number {
    let state = this.sessions.get(record.sessionId);
    if (!state) {
      state = { bytesTotal: 0, bytesByDestination: new Map(), lastEvent: '' };
      this.sessions.set(record.sessionId, state);
    }
    state.bytesTotal += record.sizeBytes;
    const destTotal = state.bytesByDestination.get(record.destination) ?? 0;
    state.bytesByDestination.set(record.destination, destTotal + record.sizeBytes);
    state.lastEvent = record.timestamp;
    return state.bytesTotal;
  }

  private scanPayload(payload: string, destination: string): SensitiveDataMatch[] {
    const matches: SensitiveDataMatch[] = [];
    for (const pattern of SENSITIVE_PATTERNS) {
      if (this.severityLevel(pattern.severity) < this.severityLevel(this.config.minSensitiveSeverity)) {
        continue;
      }
      const match = payload.match(pattern.regex);
      if (match) {
        matches.push({
          patternName: pattern.name,
          severity: pattern.severity,
          match: match[0].substring(0, 80),
        });
      }
    }
    return matches;
  }

  private checkBaselineDeviation(record: TransferRecord): AnomalyIndicator | null {
    if (!this.baseline) return null;

    const zScore =
      this.baseline.stddevBytesPerEvent > 0
        ? (record.sizeBytes - this.baseline.meanBytesPerEvent) /
          this.baseline.stddevBytesPerEvent
        : 0;

    if (Math.abs(zScore) >= this.config.anomalyZScoreThreshold) {
      return {
        metric: 'bytes_per_event',
        observedValue: record.sizeBytes,
        baselineMean: this.baseline.meanBytesPerEvent,
        baselineStddev: this.baseline.stddevBytesPerEvent,
        deviationZScore: zScore,
      };
    }
    return null;
  }

  private recordHistory(record: TransferRecord): void {
    this.history.push({
      agentId: record.agentId,
      bytes: record.sizeBytes,
      calls: 1,
      destination: record.destination,
    });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  private calculateRiskScore(
    reasons: ReasonCode[],
    matches: SensitiveDataMatch[],
    anomalies: AnomalyIndicator[],
  ): number {
    let score = 0;

    // Base contribution from reasons
    for (const reason of reasons) {
      switch (reason) {
        case 'session_limit_exceeded':
          score += 0.4;
          break;
        case 'high_volume_outbound':
          score += 0.3;
          break;
        case 'sensitive_data_detected':
          score += 0.35;
          break;
        case 'unusual_destination':
          score += 0.2;
          break;
        case 'baseline_deviation':
          score += 0.25;
          break;
        case 'protocol_anomaly':
          score += 0.15;
          break;
      }
    }

    // Boost from sensitive data matches (severity-weighted)
    for (const m of matches) {
      score += this.severityValue(m.severity) * 0.25;
    }

    // Boost from anomaly severity
    for (const a of anomalies) {
      score += Math.min(Math.abs(a.deviationZScore) / 10, 0.3);
    }

    return Math.min(score, 1.0);
  }

  private severityLevel(s: Severity): number {
    const levels: Record<Severity, number> = {
      [Severity.Critical]: 5,
      [Severity.High]: 4,
      [Severity.Medium]: 3,
      [Severity.Low]: 2,
      [Severity.Info]: 1,
    };
    return levels[s] ?? 0;
  }

  private severityValue(s: Severity): number {
    const values: Record<Severity, number> = {
      [Severity.Critical]: 1.0,
      [Severity.High]: 0.75,
      [Severity.Medium]: 0.5,
      [Severity.Low]: 0.25,
      [Severity.Info]: 0.05,
    };
    return values[s] ?? 0;
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private stddev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const squaredDiffs = values.map((v) => (v - mean) ** 2);
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
  }
}
