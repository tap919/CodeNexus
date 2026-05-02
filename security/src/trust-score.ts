/**
 * Trust Scoring Engine
 *
 * Computes and maintains a trust score for each agent by combining
 * weighted inputs from multiple security detector modules. Scores
 * decay exponentially over time, requiring sustained good behaviour
 * to maintain a high rating.
 *
 * Fused from Claw-Protect's reputation scoring subsystem.
 */

import { Severity, TrustScore } from '../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────

export type TrustFactor =
  | 'prompt_injection_risk'
  | 'data_exfiltration_risk'
  | 'behavioral_drift_risk'
  | 'secrets_leak_risk'
  | 'session_volume_risk'
  | 'anomaly_frequency'
  | 'error_rate'
  | 'response_quality';

export interface FactorDefinition {
  key: TrustFactor;
  /** Weight in the composite score (0.0 – 1.0). Must sum with others. */
  weight: number;
  /** How quickly this factor decays (higher = faster decay in hours^-1) */
  decayRate: number;
  /** Description for observability */
  description: string;
}

export interface TrustScoreConfig {
  /** Factor definitions and their weights */
  factors: FactorDefinition[];
  /** Exponential decay constant λ (lambda) in hours^-1.
   *  Higher values mean faster decay.
   *  t_half = ln(2) / λ */
  decayLambda: number;
  /** Interval in seconds for automatic score decay recalculation */
  decayIntervalSec: number;
  /** Score threshold below which alerts are generated (0.0 – 1.0) */
  alertThreshold: number;
  /** Minimum number of events required before a meaningful score */
  minEventsForScore: number;
  /** Boost for sustained good behaviour (applied per clean interval) */
  goodBehaviourBoost: number;
  /** Maximum score achievable */
  maxScore: number;
  /** Minimum score floor */
  minScore: number;
}

export interface AgentTrustState {
  score: number;
  factors: Record<TrustFactor, number>;
  lastUpdated: string;
  eventCount: number;
  decayedAt: string | null;
}

export interface ScoreImpact {
  factor: TrustFactor;
  delta: number;
  newValue: number;
  contribution: number;
}

export interface TrustScoreResult {
  previousScore: number;
  newScore: number;
  impacts: ScoreImpact[];
  alertTriggered: boolean;
}

// ─── Default Configuration ────────────────────────────────────

const DEFAULT_FACTORS: FactorDefinition[] = [
  {
    key: 'prompt_injection_risk',
    weight: 0.25,
    decayRate: 0.1,
    description: 'Risk of prompt injection attacks in agent inputs',
  },
  {
    key: 'data_exfiltration_risk',
    weight: 0.20,
    decayRate: 0.08,
    description: 'Risk of sensitive data leaving the agent boundary',
  },
  {
    key: 'behavioral_drift_risk',
    weight: 0.15,
    decayRate: 0.05,
    description: 'Deviation from established behavioural baselines',
  },
  {
    key: 'secrets_leak_risk',
    weight: 0.22,
    decayRate: 0.1,
    description: 'Presence of secrets or credentials in agent output',
  },
  {
    key: 'session_volume_risk',
    weight: 0.05,
    decayRate: 0.15,
    description: 'Unusual outbound data volume per session',
  },
  {
    key: 'anomaly_frequency',
    weight: 0.07,
    decayRate: 0.12,
    description: 'Frequency of anomalous events over time',
  },
  {
    key: 'error_rate',
    weight: 0.06,
    decayRate: 0.2,
    description: 'Rate of errors/failures in agent operations',
  },
];

const DEFAULT_CONFIG: TrustScoreConfig = {
  factors: DEFAULT_FACTORS,
  decayLambda: 0.05, // ~13.9 hour half-life
  decayIntervalSec: 300, // 5 minutes
  alertThreshold: 0.4,
  minEventsForScore: 5,
  goodBehaviourBoost: 0.02,
  maxScore: 1.0,
  minScore: 0.0,
};

// ─── Trust Score Engine ───────────────────────────────────────

export class TrustScoreEngine {
  private config: TrustScoreConfig;
  private agents: Map<string, AgentTrustState> = new Map();

  /** Tracks time since last decay pass */
  private lastDecayPass: number = Date.now();
  /** Tracks consecutive clean intervals for good behaviour boost */
  private cleanIntervals: Map<string, number> = new Map();

  constructor(config: Partial<TrustScoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Initialise or reset an agent's trust state.
   */
  initAgent(agentId: string, initialScore = 0.8): AgentTrustState {
    const state: AgentTrustState = {
      score: initialScore,
      factors: this.initialFactors(),
      lastUpdated: new Date().toISOString(),
      eventCount: 0,
      decayedAt: null,
    };
    this.agents.set(agentId, state);
    this.cleanIntervals.set(agentId, 0);
    return state;
  }

  /**
   * Core update: apply risk signals from security detectors and
   * return the resulting impact.
   */
  updateScore(
    agentId: string,
    riskUpdates: Partial<Record<TrustFactor, number>>,
  ): TrustScoreResult {
    let state = this.agents.get(agentId);
    if (!state) {
      state = this.initAgent(agentId);
    }

    const previousScore = state.score;

    // Apply exponential decay before incorporating new signals
    this.applyDecay(state);

    // Record the current factor values before update
    const impacts: ScoreImpact[] = [];

    for (const [factorKey, riskValue] of Object.entries(riskUpdates)) {
      const factor = factorKey as TrustFactor;
      if (riskValue === undefined) continue;

      const oldFactorValue = state.factors[factor] ?? 0;

      // Risk values are 0.0 (safe) to 1.0 (critical). We blend
      // the new observation with the historical value to smooth spikes.
      const blended = oldFactorValue * 0.6 + riskValue * 0.4;
      state.factors[factor] = Math.min(blended, 1.0);

      const fd = this.config.factors.find((f) => f.key === factor);
      const contribution = fd ? blended * fd.weight : 0;

      impacts.push({
        factor,
        delta: blended - oldFactorValue,
        newValue: blended,
        contribution,
      });
    }

    state.eventCount++;
    state.lastUpdated = new Date().toISOString();

    // Recalculate composite score
    state.score = this.compositeScore(state);

    // Good behaviour boost: if all risk factors are low, reward the agent
    const maxFactor = Math.max(...Object.values(state.factors));
    if (maxFactor < 0.15) {
      const intervals = this.cleanIntervals.get(agentId) ?? 0;
      this.cleanIntervals.set(agentId, intervals + 1);

      if (intervals >= 2) {
        state.score = Math.min(
          state.score + this.config.goodBehaviourBoost,
          this.config.maxScore,
        );
      }
    } else {
      this.cleanIntervals.set(agentId, 0);
    }

    // Enforce bounds
    state.score = Math.max(this.config.minScore, Math.min(this.config.maxScore, state.score));

    const alertTriggered = state.score < this.config.alertThreshold;

    return {
      previousScore,
      newScore: state.score,
      impacts,
      alertTriggered,
    };
  }

  /**
   * Apply time-based decay to all agents.
   */
  decayAll(): void {
    const now = Date.now();
    for (const state of this.agents.values()) {
      this.applyDecay(state);
    }
    this.lastDecayPass = now;
  }

  /**
   * Get the current trust score for an agent.
   */
  getScore(agentId: string): TrustScore | null {
    const state = this.agents.get(agentId);
    if (!state) return null;

    this.applyDecay(state);

    return {
      agentId,
      score: state.score,
      factors: { ...state.factors },
      lastUpdated: state.lastUpdated,
    };
  }

  /**
   * Get the raw internal state for an agent.
   */
  getState(agentId: string): Readonly<AgentTrustState> | undefined {
    const state = this.agents.get(agentId);
    if (!state) return undefined;
    this.applyDecay(state);
    return { ...state, factors: { ...state.factors } };
  }

  /**
   * Reset an agent's trust state.
   */
  resetAgent(agentId: string, initialScore = 0.8): void {
    this.agents.delete(agentId);
    this.cleanIntervals.delete(agentId);
    this.initAgent(agentId, initialScore);
  }

  /**
   * Export all agent trust states.
   */
  getAllScores(): Map<string, TrustScore> {
    const scores = new Map<string, TrustScore>();
    for (const [agentId, state] of this.agents.entries()) {
      this.applyDecay(state);
      scores.set(agentId, {
        agentId,
        score: state.score,
        factors: { ...state.factors },
        lastUpdated: state.lastUpdated,
      });
    }
    return scores;
  }

  /**
   * Determine the overall security severity from a trust score.
   */
  static severityFromScore(score: number): Severity {
    if (score < 0.2) return Severity.Critical;
    if (score < 0.35) return Severity.High;
    if (score < 0.5) return Severity.Medium;
    if (score < 0.7) return Severity.Low;
    return Severity.Info;
  }

  updateConfig(partial: Partial<TrustScoreConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * Exponential decay function.
   *   new_value = old_value * e^(-λ * Δt)
   *
   * This naturally pushes risk factors toward zero (good) over time,
   * meaning the agent's score recovers if no new risks are observed.
   */
  private applyDecay(state: AgentTrustState): void {
    const now = Date.now();
    const lastUpdate = new Date(state.lastUpdated).getTime();
    const elapsedHours = (now - lastUpdate) / 3_600_000;

    if (elapsedHours <= 0) return;

    for (const fd of this.config.factors) {
      const currentValue = state.factors[fd.key] ?? 0;
      if (currentValue <= 0) continue;

      // Effective decay rate combines the global lambda with the
      // factor-specific decay rate.
      const effectiveLambda = this.config.decayLambda * (1 + fd.decayRate);
      const decayed = currentValue * Math.exp(-effectiveLambda * elapsedHours);
      state.factors[fd.key] = Math.max(decayed, 0);
    }

    // Recalculate composite score after decay
    state.score = this.compositeScore(state);
    state.decayedAt = new Date().toISOString();
    state.lastUpdated = new Date().toISOString();
  }

  /**
   * Compute the composite trust score from factor values.
   *   score = 1.0 - Σ(weight_i * factorValue_i)
   *
   * This gives a score in [0, 1] where 1.0 = perfect trust.
   */
  private compositeScore(state: AgentTrustState): number {
    let riskSum = 0;
    let weightSum = 0;

    for (const fd of this.config.factors) {
      const value = state.factors[fd.key] ?? 0;
      riskSum += fd.weight * value;
      weightSum += fd.weight;
    }

    // Normalise in case weights don't sum to 1
    const normalisedRisk = weightSum > 0 ? riskSum / weightSum : 0;

    return Math.max(
      this.config.minScore,
      Math.min(this.config.maxScore, 1 - normalisedRisk),
    );
  }

  private initialFactors(): Record<TrustFactor, number> {
    const factors: Partial<Record<TrustFactor, number>> = {};
    for (const fd of this.config.factors) {
      factors[fd.key] = 0;
    }
    return factors as Record<TrustFactor, number>;
  }
}
