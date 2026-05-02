// ─── Shared Type Definitions ─────────────────────────────────────
// Foundation types consumed by policy-engine, deep-audit,
// evidence-store, and all other CodeNexus packages.
//
// This file is the canonical home for enumerations and structural
// interfaces that cross package boundaries.  Domain‑specific
// extensions live in each package's own types.ts.

// ─── Risk Level ─────────────────────────────────────────────────
/** Ordered severity of a change set (Critical > High > Medium > Low). */
export enum RiskLevel {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

// ─── Merge Blocker Type ─────────────────────────────────────────
/** The four MUST‑block conditions defined in spec §7. */
export enum MergeBlockerType {
  /** §7.1 – Insufficient human review coverage. */
  MISSING_HUMAN_REVIEW = 'MISSING_HUMAN_REVIEW',
  /** §7.2 – Disputed findings that have not been resolved. */
  UNRESOLVED_DISPUTED_FINDINGS = 'UNRESOLVED_DISPUTED_FINDINGS',
  /** §7.3 – Workflow permissions that allow untrusted code execution. */
  INSECURE_WORKFLOW_PERMISSIONS = 'INSECURE_WORKFLOW_PERMISSIONS',
  /** §7.4 – Multi‑step transaction with no rollback / compensating action. */
  TRANSACTION_INTEGRITY_FAILURE = 'TRANSACTION_INTEGRITY_FAILURE',
}

// ─── Evidence Type ──────────────────────────────────────────────
/** Categories of evidence that the platform can collect and verify. */
export enum EvidenceType {
  LAYER3_RETRIEVAL = 'LAYER3_RETRIEVAL',
  DUAL_HUMAN_SIGN_OFF = 'DUAL_HUMAN_SIGN_OFF',
  LENS_RESULTS = 'LENS_RESULTS',
  RACE_CONDITION_TEST = 'RACE_CONDITION_TEST',
  PLAYWRIGHT_TRACE = 'PLAYWRIGHT_TRACE',
  EVIDENCE_STORE_ENTRY = 'EVIDENCE_STORE_ENTRY',
  AUDIT_LOG_PII_PROOF = 'AUDIT_LOG_PII_PROOF',
  DEEP_E2E_TEST = 'DEEP_E2E_TEST',
  INVARIANT_DOCUMENTATION = 'INVARIANT_DOCUMENTATION',
  RUNTIME_VERIFICATION = 'RUNTIME_VERIFICATION',
  NEGATIVE_PATH_TEST = 'NEGATIVE_PATH_TEST',
  SOURCE_REVIEW = 'SOURCE_REVIEW',
}

// ─── Risk Classification ────────────────────────────────────────
/** Result of `PolicyEngine.classifyRisk()`. */
export interface RiskClassification {
  level: RiskLevel;
  /** Human‑readable chain of reasoning. */
  justification: string;
  /** Patterns that triggered this classification. */
  triggers: string[];
}

// ─── Required Artifacts ─────────────────────────────────────────
/** Lightweight forward‑reference; full shape in policy‑engine/types. */
export interface RequiredArtifactSpec {
  type: EvidenceType;
  mandatory: boolean;
  description: string;
  validator?: (artifact: EvidenceArtifact) => boolean;
}

/** Aggregation returned by `PolicyEngine.getRequiredArtifacts()`. */
export interface RequiredArtifacts {
  riskLevel: RiskLevel;
  artifacts: RequiredArtifactSpec[];
}

// ─── Required Reviewers ─────────────────────────────────────────
/** Human & bot reviewer requirements per risk band. */
export interface RequiredReviewers {
  minHumans: number;
  minCodeOwners: number;
  /** When true, bot reviews contribute to the review count. */
  botReviewCounts: boolean;
}

// ─── Merge Blocker ──────────────────────────────────────────────
/** A single blocking condition emitted by `evaluateBlockers()`. */
export interface MergeBlocker {
  type: MergeBlockerType;
  active: boolean;
  description: string;
  details: string;
  blockedBy: string;
  resolution: string;
}

// ─── Waiver Record ──────────────────────────────────────────────
/**
 * Full waiver record.  The policy‑engine is the sole writer;
 * other packages read this shape.
 */
export interface WaiverRecord {
  id: string;
  findingId: string;
  riskLevel: RiskLevel;
  justification: string;
  requestedBy: string;
  approvals: WaiverApprovalEntry[];
  requiredApprovals: number;
  valid: boolean;
  createdAt: string;
  expiresAt: string;
}

/** Single approval entry within a WaiverRecord. */
export interface WaiverApprovalEntry {
  reviewer: string;
  timestamp: string;
  notes: string;
}

// ─── Evidence Artifact ──────────────────────────────────────────
/** An opaque piece of evidence stored in the evidence‑store. */
export interface EvidenceArtifact {
  id: string;
  type: EvidenceType;
  content: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Audit Finding ──────────────────────────────────────────────
/**
 * Findings produced by deep‑audit detectors.
 * Consumed by `evaluateBlockers()` and `requestWaiver()`.
 */
export interface AuditFinding {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  /** §7.2 – true when a human has flagged the finding as contentious. */
  disputed: boolean;
  /** §7.2 – true when the dispute has been addressed. */
  resolved: boolean;
  createdAt: string;
}

// ─── Detector Result ────────────────────────────────────────────
/**
 * Per‑detector scoring input for `calibrateConfidence()`.
 * Inspired by the InjecGuard confidence‑calibration model.
 */
export interface DetectorResult {
  detectorName: string;
  rawScore: number;
  findings: AuditFinding[];
  falsePositives: number;
  truePositives: number;
  falseNegatives: number;
  totalEvaluated: number;
}
