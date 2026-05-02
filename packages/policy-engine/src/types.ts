// ─── Policy‑Engine Domain Types ─────────────────────────────────
// Policy‑specific interfaces that extend the shared‑types
// foundation.  These types are the single source of truth for
// artifact requirements, merge gating context, waiver records,
// confidence calibration, and normative‑rule evaluation.

import type {
  EvidenceType,
  EvidenceArtifact,
  AuditFinding,
  RiskLevel,
  DetectorResult,
} from "../../shared-types/src/types.js";

// ─── Required Artifact Spec ─────────────────────────────────────
/**
 * Describes one piece of evidence that must be present before a
 * merge can proceed at a given risk level (§6).
 *
 * `validator` is an optional predicate that inspects the artifact
 * payload and returns `true` when the evidence is sufficient.
 */
export interface RequiredArtifactSpec {
  type: EvidenceType;
  mandatory: boolean;
  description: string;
  validator?: (artifact: EvidenceArtifact) => boolean;
}

// ─── Merge Context ──────────────────────────────────────────────
/**
 * Full contextual snapshot passed to `evaluateBlockers()`.
 * Captures the PR metadata, reviewer roster, audit findings,
 * workflow files touched, and whether a rollback mechanism exists.
 */
export interface MergeContext {
  prNumber: number;
  riskLevel: RiskLevel;
  reviewers: { login: string; isBot: boolean; isCodeOwner: boolean }[];
  findings: AuditFinding[];
  workflowFiles: string[];
  hasRollbackMechanism: boolean;
}

// ─── Waiver Record ──────────────────────────────────────────────
/**
 * Canonical waiver record (§8).
 *
 * CRITICAL → 2 approvals required.
 * HIGH     → 1 approval required.
 * MEDIUM / LOW → auto‑approved with a justification.
 *
 * `valid` is computed by `isWaiverValid()` and reflects whether
 * the waiver has sufficient approvals and has not expired.
 */
export interface WaiverRecord {
  id: string;
  findingId: string;
  riskLevel: RiskLevel;
  justification: string;
  requestedBy: string;
  approvals: { reviewer: string; timestamp: string; notes: string }[];
  requiredApprovals: number;
  valid: boolean;
  createdAt: string;
  expiresAt: string;
}

// ─── Calibrated Score ───────────────────────────────────────────
/**
 * Output of `calibrateConfidence()` (§9 – InjecGuard model).
 *
 * False positives are penalised at 0.5× the weight of false
 * negatives, reflecting the principle that over‑defense is
 * less harmful than under‑defense but still undesirable.
 */
export interface CalibratedScore {
  rawScore: number;
  calibratedScore: number;
  falsePositivePenalty: number;
  detectorName: string;
}

// ─── Normative Rule Result ──────────────────────────────────────
/**
 * Result of evaluating one normative rule (§10).
 *
 * | Level  | Violation behaviour                                    |
 * |--------|-------------------------------------------------------|
 * | MUST   | `block: true` – merge cannot proceed without a waiver. |
 * | SHOULD | `warn: true` + `justificationRequired: true`.          |
 * | MAY    | `advisory: true` – informational only.                 |
 */
export interface NormativeRuleResult {
  ruleId: string;
  level: "MUST" | "SHOULD" | "MAY";
  description: string;
  violated: boolean;
  block: boolean;
  warn: boolean;
  justificationRequired: boolean;
  advisory: boolean;
}
