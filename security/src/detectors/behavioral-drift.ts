/**
 * Behavioral Drift Detector
 *
 * Baselines normal agent behaviour — tool usage patterns, call
 * frequencies, and response characteristics — then flags anomalous
 * deviations using sliding-window analysis with configurable
 * thresholds.
 *
 * Fused from Claw-Protect's behavioural profiling engine.
 */

import { Severity } from '../../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────

export interface AgentAction {
  agentId: string;
  sessionId: string;
  timestamp: string;
  /** Tool or function being invoked */
  toolName: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of tokens in the input prompt */
  inputTokens: number;
  /** Number of tokens in the output response */
  outputTokens: number;
  /** Was the call successful? */
  success: boolean;
  /** Error message, if applicable */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface BehaviorBaseline {
  agentId: string;
  /** Per-tool call frequency (calls / hour) */
  toolFrequencies: Record<string, number>;
  /** Mean duration per tool */
  toolDurations: Record<string, { mean: number; stddev: number }>;
  /** Mean input token count per tool */
  toolInputTokens: Record<string, { mean: number; stddev: number }>;
  /** Mean output token count per tool */
  toolOutputTokens: Record<string, { mean: number; stddev: number }>;
  /** Overall success rate (0.0 – 1.0) */
  successRate: number;
  /** Error rate per tool */
  toolErrorRates: Record<string, number>;
  /** Number of samples in the baseline */
  sampleCount: number;
  /** Timestamp this baseline was built */
  builtAt: string;
}

export interface DriftResult {
  detected: boolean;
  driftScore: number; // 0.0 – 1.0
  anomalousMetrics: DriftMetric[];
  severity: Severity;
}

export interface DriftMetric {
  metricName: string;
  toolName: string;
  observedValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationZScore: number;
  contribution: number; // contribution to total drift score
}

export type DriftWindow = 'short' | 'medium' | 'long';

// ─── Configuration ────────────────────────────────────────────

export interface BehavioralDriftConfig {
  /** Z-score threshold beyond which a metric is considered drifted */
  zScoreThreshold: number;
  /** Minimum baseline sample count before detections activate */
  minSamples: number;
  /** Window sizes in minutes for short / medium / long */
  windows: Record<DriftWindow, number>;
  /** How often (in seconds) to auto-rebuild baselines */
  autoRebuildIntervalSec: number;
  /** Maximum number of recent actions to retain */
  maxHistory: number;
  /** Tools to exempt from profiling */
  exemptTools: string[];
  /** Weight multipliers per metric category */
  metricWeights: {
    toolFrequency: number;
    toolDuration: number;
    inputTokens: number;
    outputTokens: number;
    successRate: number;
    errorRate: number;
  };
}

const DEFAULT_CONFIG: BehavioralDriftConfig = {
  zScoreThreshold: 2.5,
  minSamples: 20,
  windows: { short: 5, medium: 30, long: 120 },
  autoRebuildIntervalSec: 300,
  maxHistory: 50_000,
  exemptTools: ['read_file', 'list_directory', 'grep'],
  metricWeights: {
    toolFrequency: 0.25,
    toolDuration: 0.2,
    inputTokens: 0.15,
    outputTokens: 0.15,
    successRate: 0.1,
    errorRate: 0.15,
  },
};

// ─── Detector Class ───────────────────────────────────────────

export class BehavioralDriftDetector {
  private config: BehavioralDriftConfig;

  /** Full history of agent actions (ring buffer) */
  private history: AgentAction[] = [];

  /** Cached baselines keyed by agentId */
  private baselines: Map<string, BehaviorBaseline> = new Map();

  /** Last rebuild timestamp per agent */
  private lastRebuild: Map<string, number> = new Map();

  constructor(config: Partial<BehavioralDriftConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Record a new agent action for future baselining and immediately
   * evaluate it for drift.
   */
  recordAndAnalyze(action: AgentAction): DriftResult {
    this.history.push(action);
    if (this.history.length > this.config.maxHistory) {
      this.history.shift();
    }

    const baseline = this.getOrBuildBaseline(action.agentId);
    return this.evaluateDrift(action, baseline);
  }

  /**
   * Evaluate a single action against the current baseline without
   * adding it to history (pure analysis mode).
   */
  evaluate(action: AgentAction): DriftResult {
    const baseline = this.baselines.get(action.agentId);
    if (!baseline) {
      return {
        detected: false,
        driftScore: 0,
        anomalousMetrics: [],
        severity: Severity.Info,
      };
    }
    return this.evaluateDrift(action, baseline);
  }

  /**
   * Force rebuild the baseline for a specific agent.
   */
  rebuildBaseline(agentId: string): BehaviorBaseline {
    const baseline = this.computeBaseline(
      agentId,
      this.getAgentActions(agentId),
    );
    this.baselines.set(agentId, baseline);
    this.lastRebuild.set(agentId, Date.now());
    return baseline;
  }

  /**
   * Get the cached baseline for an agent, auto-rebuilding if stale.
   */
  getBaseline(agentId: string): BehaviorBaseline | undefined {
    const bl = this.baselines.get(agentId);
    const last = this.lastRebuild.get(agentId) ?? 0;

    if (
      !bl ||
      Date.now() - last > this.config.autoRebuildIntervalSec * 1000
    ) {
      return this.rebuildBaseline(agentId);
    }
    return bl;
  }

  /**
   * Windowed analysis: compare behaviour in the last N minutes
   * against the full baseline.
   */
  windowedAnalysis(
    agentId: string,
    window: DriftWindow = 'short',
  ): DriftResult {
    const baseline = this.getBaseline(agentId);
    if (!baseline || baseline.sampleCount < this.config.minSamples) {
      return {
        detected: false,
        driftScore: 0,
        anomalousMetrics: [],
        severity: Severity.Info,
      };
    }

    const windowMinutes = this.config.windows[window];
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const windowActions = this.getAgentActions(agentId).filter(
      (a) => new Date(a.timestamp).getTime() > cutoff,
    );

    if (windowActions.length < 3) {
      return {
        detected: false,
        driftScore: 0,
        anomalousMetrics: [],
        severity: Severity.Info,
      };
    }

    const windowBaseline = this.computeBaseline(agentId, windowActions);
    return this.compareBaselines(baseline, windowBaseline);
  }

  /**
   * Purge history for a given agent.
   */
  resetAgent(agentId: string): void {
    this.history = this.history.filter((a) => a.agentId !== agentId);
    this.baselines.delete(agentId);
    this.lastRebuild.delete(agentId);
  }

  updateConfig(partial: Partial<BehavioralDriftConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getHistory(agentId: string): readonly AgentAction[] {
    return this.getAgentActions(agentId);
  }

  // ── Private ──────────────────────────────────────────────

  private getAgentActions(agentId: string): AgentAction[] {
    return this.history.filter((a) => a.agentId === agentId);
  }

  private getOrBuildBaseline(agentId: string): BehaviorBaseline {
    const cached = this.baselines.get(agentId);
    const last = this.lastRebuild.get(agentId) ?? 0;

    if (
      !cached ||
      Date.now() - last > this.config.autoRebuildIntervalSec * 1000
    ) {
      return this.rebuildBaseline(agentId);
    }
    return cached;
  }

  private computeBaseline(
    agentId: string,
    actions: AgentAction[],
  ): BehaviorBaseline {
    const toolGroups = this.groupByTool(actions);
    const toolFrequencies: Record<string, number> = {};
    const toolDurations: Record<string, { mean: number; stddev: number }> = {};
    const toolInputTokens: Record<string, { mean: number; stddev: number }> = {};
    const toolOutputTokens: Record<string, { mean: number; stddev: number }> = {};
    const toolErrorRates: Record<string, number> = {};

    // Determine time span in hours
    const timestamps = actions.map((a) => new Date(a.timestamp).getTime());
    const spanHours =
      timestamps.length > 1
        ? Math.max((Math.max(...timestamps) - Math.min(...timestamps)) / 3_600_000, 0.01)
        : 0.01;

    for (const [tool, acts] of Object.entries(toolGroups)) {
      // Frequency
      toolFrequencies[tool] = acts.length / spanHours;

      // Duration stats
      const durations = acts.map((a) => a.durationMs);
      toolDurations[tool] = {
        mean: this.mean(durations),
        stddev: this.stddev(durations, this.mean(durations)),
      };

      // Input tokens
      const inTokens = acts.map((a) => a.inputTokens);
      toolInputTokens[tool] = {
        mean: this.mean(inTokens),
        stddev: this.stddev(inTokens, this.mean(inTokens)),
      };

      // Output tokens
      const outTokens = acts.map((a) => a.outputTokens);
      toolOutputTokens[tool] = {
        mean: this.mean(outTokens),
        stddev: this.stddev(outTokens, this.mean(outTokens)),
      };

      // Error rate
      const failures = acts.filter((a) => !a.success).length;
      toolErrorRates[tool] = failures / acts.length;
    }

    const totalActions = actions.length;
    const totalFailures = actions.filter((a) => !a.success).length;

    return {
      agentId,
      toolFrequencies,
      toolDurations,
      toolInputTokens,
      toolOutputTokens,
      successRate: totalActions > 0 ? 1 - totalFailures / totalActions : 1,
      toolErrorRates,
      sampleCount: totalActions,
      builtAt: new Date().toISOString(),
    };
  }

  private evaluateDrift(action: AgentAction, baseline: BehaviorBaseline): DriftResult {
    if (baseline.sampleCount < this.config.minSamples) {
      return {
        detected: false,
        driftScore: 0,
        anomalousMetrics: [],
        severity: Severity.Info,
      };
    }

    const exempted = this.config.exemptTools.includes(action.toolName);
    const metrics: DriftMetric[] = [];

    // Check tool frequency drift (only if not exempt)
    if (!exempted && baseline.toolFrequencies[action.toolName] !== undefined) {
      const freq = baseline.toolFrequencies[action.toolName];
      // Observed frequency: 1 action / hour (rough approximation)
      const observedFreq = 1;
      if (freq > 0) {
        const z = (observedFreq - freq) / Math.max(freq * 0.3, 0.1); // assume CV ~ 30%
        if (Math.abs(z) >= this.config.zScoreThreshold) {
          metrics.push({
            metricName: 'tool_frequency',
            toolName: action.toolName,
            observedValue: observedFreq,
            baselineMean: freq,
            baselineStddev: freq * 0.3,
            deviationZScore: z,
            contribution: this.config.metricWeights.toolFrequency * Math.min(Math.abs(z) / 5, 1),
          });
        }
      }
    }

    // Duration drift
    const durStats = baseline.toolDurations[action.toolName];
    if (durStats && durStats.stddev > 0) {
      const z = (action.durationMs - durStats.mean) / durStats.stddev;
      if (Math.abs(z) >= this.config.zScoreThreshold) {
        metrics.push({
          metricName: 'tool_duration',
          toolName: action.toolName,
          observedValue: action.durationMs,
          baselineMean: durStats.mean,
          baselineStddev: durStats.stddev,
          deviationZScore: z,
          contribution: this.config.metricWeights.toolDuration * Math.min(Math.abs(z) / 5, 1),
        });
      }
    }

    // Input token count drift
    const inStats = baseline.toolInputTokens[action.toolName];
    if (inStats && inStats.stddev > 0) {
      const z = (action.inputTokens - inStats.mean) / inStats.stddev;
      if (Math.abs(z) >= this.config.zScoreThreshold) {
        metrics.push({
          metricName: 'input_tokens',
          toolName: action.toolName,
          observedValue: action.inputTokens,
          baselineMean: inStats.mean,
          baselineStddev: inStats.stddev,
          deviationZScore: z,
          contribution: this.config.metricWeights.inputTokens * Math.min(Math.abs(z) / 5, 1),
        });
      }
    }

    // Output token count drift
    const outStats = baseline.toolOutputTokens[action.toolName];
    if (outStats && outStats.stddev > 0) {
      const z = (action.outputTokens - outStats.mean) / outStats.stddev;
      if (Math.abs(z) >= this.config.zScoreThreshold) {
        metrics.push({
          metricName: 'output_tokens',
          toolName: action.toolName,
          observedValue: action.outputTokens,
          baselineMean: outStats.mean,
          baselineStddev: outStats.stddev,
          deviationZScore: z,
          contribution: this.config.metricWeights.outputTokens * Math.min(Math.abs(z) / 5, 1),
        });
      }
    }

    // Success / error drift
    if (!exempted && !action.success) {
      const errRate = baseline.toolErrorRates[action.toolName] ?? 0;
      if (errRate < 0.1) {
        // A failure when error rate is very low is anomalous
        metrics.push({
          metricName: 'error_rate',
          toolName: action.toolName,
          observedValue: 1,
          baselineMean: errRate,
          baselineStddev: Math.max(errRate, 0.02),
          deviationZScore: (1 - errRate) / Math.max(errRate, 0.02),
          contribution: this.config.metricWeights.errorRate * 0.8,
        });
      }
    }

    const driftScore = Math.min(metrics.reduce((s, m) => s + m.contribution, 0), 1.0);
    const severity = this.classifySeverity(driftScore);
    const detected = driftScore > 0.15; // minimum threshold for being noticeable

    return { detected, driftScore, anomalousMetrics: metrics, severity };
  }

  private compareBaselines(
    full: BehaviorBaseline,
    window: BehaviorBaseline,
  ): DriftResult {
    const metrics: DriftMetric[] = [];
    const allTools = new Set([
      ...Object.keys(full.toolFrequencies),
      ...Object.keys(window.toolFrequencies),
    ]);

    for (const tool of allTools) {
      // Frequency comparison
      const fullFreq = full.toolFrequencies[tool] ?? 0;
      const winFreq = window.toolFrequencies[tool] ?? 0;
      if (fullFreq > 0) {
        const z = (winFreq - fullFreq) / Math.max(fullFreq * 0.3, 0.1);
        if (Math.abs(z) >= this.config.zScoreThreshold) {
          metrics.push({
            metricName: 'tool_frequency',
            toolName: tool,
            observedValue: winFreq,
            baselineMean: fullFreq,
            baselineStddev: fullFreq * 0.3,
            deviationZScore: z,
            contribution: this.config.metricWeights.toolFrequency * Math.min(Math.abs(z) / 5, 1),
          });
        }
      }
    }

    // Duration comparison
    for (const tool of allTools) {
      const fullDs = full.toolDurations[tool];
      const winDs = window.toolDurations[tool];
      if (fullDs && winDs && fullDs.stddev > 0) {
        const z = (winDs.mean - fullDs.mean) / fullDs.stddev;
        if (Math.abs(z) >= this.config.zScoreThreshold) {
          metrics.push({
            metricName: 'tool_duration',
            toolName: tool,
            observedValue: winDs.mean,
            baselineMean: fullDs.mean,
            baselineStddev: fullDs.stddev,
            deviationZScore: z,
            contribution: this.config.metricWeights.toolDuration * Math.min(Math.abs(z) / 5, 1),
          });
        }
      }
    }

    const driftScore = Math.min(metrics.reduce((s, m) => s + m.contribution, 0), 1.0);
    const severity = this.classifySeverity(driftScore);
    return {
      detected: driftScore > 0.15,
      driftScore,
      anomalousMetrics: metrics,
      severity,
    };
  }

  private groupByTool(actions: AgentAction[]): Record<string, AgentAction[]> {
    const groups: Record<string, AgentAction[]> = {};
    for (const a of actions) {
      if (!this.config.exemptTools.includes(a.toolName)) {
        (groups[a.toolName] ??= []).push(a);
      }
    }
    return groups;
  }

  private classifySeverity(score: number): Severity {
    if (score >= 0.7) return Severity.Critical;
    if (score >= 0.5) return Severity.High;
    if (score >= 0.3) return Severity.Medium;
    if (score >= 0.15) return Severity.Low;
    return Severity.Info;
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private stddev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const sqDiffs = values.map((v) => (v - mean) ** 2);
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
  }
}
