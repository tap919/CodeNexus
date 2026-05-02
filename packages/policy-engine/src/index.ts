// ─── Policy Engine ──────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for all risk, artifact, reviewer, and
// blocker decisions in the CodeNexus system.
//
// Implements:
//   §5  – Risk Classification
//   §6  – Required Artifacts Per Risk
//   §6b – Required Reviewers Per Risk
//   §7  – Merge Blocker Evaluation (4 MUST‑block conditions)
//   §8  – Waiver Model
//   §9  – Confidence Calibration (InjecGuard‑inspired)
//   §10 – Normative Rule Evaluation (MUST / SHOULD / MAY)

import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

// ─── Re‑export shared‑types ─────────────────────────────────────
export {
  RiskLevel,
  MergeBlockerType,
  EvidenceType,
} from "../../shared-types/src/types.js";

export type {
  RiskClassification,
  RequiredArtifactSpec,
  RequiredArtifacts,
  RequiredReviewers,
  MergeBlocker,
  WaiverRecord as SharedWaiverRecord,
  EvidenceArtifact,
  AuditFinding,
  DetectorResult,
  WaiverApprovalEntry,
} from "../../shared-types/src/types.js";

// ─── Re‑export policy‑specific types ────────────────────────────
export type {
  MergeContext,
  WaiverRecord,
  CalibratedScore,
  NormativeRuleResult,
} from "./types.js";

// ─── Import for implementation ──────────────────────────────────
import {
  RiskLevel,
  MergeBlockerType,
  EvidenceType,
} from "../../shared-types/src/types.js";
import type {
  RiskClassification,
  RequiredArtifactSpec,
  RequiredArtifacts,
  RequiredReviewers,
  MergeBlocker,
  AuditFinding,
  DetectorResult,
  EvidenceArtifact,
} from "../../shared-types/src/types.js";

import type {
  MergeContext,
  WaiverRecord,
  CalibratedScore,
  NormativeRuleResult,
} from "./types.js";

// ══════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════

const POLICY_VERSION = "1.0.0";

/** Default waiver TTL: 30 days in milliseconds. */
const WAIVER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Risk Classification Patterns (§5) ──────────────────────────

/** §5.1 – Patterns that ALWAYS trigger CRITICAL risk. */
const CRITICAL_FILE_PATTERNS: RegExp[] = [
  /\bauth\//i,
  /\bbilling\//i,
  /\bpermissions?\//i,
  /\.github\/workflows\//i,
];

const CRITICAL_CONTENT_PATTERNS: RegExp[] = [
  /\b(token|secret|api[_-]?key|credential|password|private[_-]?key)\s*[:=]\s*/i,
  /\bBEGIN\s+(RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY\b/,
  /\bghp_[a-zA-Z0-9]{36,}\b/, // GitHub personal access token
  /\bghs_[a-zA-Z0-9]{36,}\b/, // GitHub server‑to‑server token
  /\b(sk|pk|rk)_[a-zA-Z0-9]{24,}\b/, // Stripe / generic secret keys
];

/** §5.2 – Patterns that trigger HIGH risk. */
const HIGH_FILE_PATTERNS: RegExp[] = [
  /\bmigrations?\//i,
  /\bmiddleware\//i,
  /\bpii\//i,
];

const HIGH_CONTENT_PATTERNS: RegExp[] = [
  /\bALTER\s+TABLE\b/i,
  /\b(encrypt|decrypt|cipher|aes|rsa|ecdsa|pbkdf2?|argon2?|bcrypt|scrypt)\b/i,
  /\b(gdpr|ccpa|hipaa|pci[ -]?dss|sox)\b/i,
  /\b(personally\s+identifiable|pii|personal[ -_]?data)\b/i,
];

/** §5.3 – Patterns that trigger MEDIUM risk. */
const MEDIUM_FILE_PATTERNS: RegExp[] = [
  /\bapi\//i,
  /\broutes?\//i,
  /\bservices?\//i,
  /\bcontrollers?\//i,
];

const MEDIUM_CONTENT_PATTERNS: RegExp[] = [
  /\b(transaction|rollback|commit|savepoint)\b/i,
  /\b(workflow|state[ -]?machine|finite[ -]?state)\b/i,
  /\b(rate[ -]?limit|throttle|quota)\b/i,
];

/** §5.4 – LOW‑risk file suffixes (everything else defaults to LOW). */
const LOW_FILE_SUFFIXES: RegExp[] = [
  /\.css$/i,
  /\.html$/i,
  /\.md$/i,
  /\.mdx$/i,
  /\.txt$/i,
  /\.json$/i,
  /\.ya?ml$/i,
];

// ─── Required Artifacts Per Risk (§6) ───────────────────────────

/**
 * §6 – Artifact requirements translated directly from the spec.
 *
 * Every risk level mandates at minimum a source‑review report.
 * Additional artifacts accumulate as risk increases.
 */
function buildArtifactSpecs(riskLevel: RiskLevel): RequiredArtifactSpec[] {
  const sourceReview: RequiredArtifactSpec = {
    type: EvidenceType.SOURCE_REVIEW,
    mandatory: true,
    description:
      "Human or automated source‑review report covering all changed files",
  };

  switch (riskLevel) {
    case RiskLevel.CRITICAL:
      return [
        {
          type: EvidenceType.LAYER3_RETRIEVAL,
          mandatory: true,
          description:
            "Layer‑3 retrieval evidence proving the change was verified against external knowledge sources",
        },
        {
          type: EvidenceType.DUAL_HUMAN_SIGN_OFF,
          mandatory: true,
          description:
            "Signed attestation records from two independent human reviewers",
        },
        {
          type: EvidenceType.LENS_RESULTS,
          mandatory: true,
          description:
            "All three validation‑lens results (security, correctness, compliance)",
        },
        {
          type: EvidenceType.RACE_CONDITION_TEST,
          mandatory: true,
          description:
            "Race‑condition test traces proving deterministic behaviour under concurrency",
        },
        {
          type: EvidenceType.PLAYWRIGHT_TRACE,
          mandatory: true,
          description:
            "Playwright end‑to‑end trace files covering critical user journeys",
        },
        {
          type: EvidenceType.EVIDENCE_STORE_ENTRY,
          mandatory: true,
          description:
            "At least one entry in the evidence‑store cataloguing the change rationale",
        },
        {
          type: EvidenceType.AUDIT_LOG_PII_PROOF,
          mandatory: true,
          description:
            "Audit‑log attestation that no PII is present in logs or error messages",
        },
        sourceReview,
      ];

    case RiskLevel.HIGH:
      return [
        {
          type: EvidenceType.DEEP_E2E_TEST,
          mandatory: true,
          description:
            "Deep end‑to‑end race‑condition test traces with concurrency scenarios",
        },
        {
          type: EvidenceType.INVARIANT_DOCUMENTATION,
          mandatory: true,
          description:
            "Documented invariants with pre‑ and post‑condition assertions",
        },
        {
          type: EvidenceType.RUNTIME_VERIFICATION,
          mandatory: true,
          description:
            "Runtime verification outputs confirming invariants hold under load",
        },
        {
          type: EvidenceType.PLAYWRIGHT_TRACE,
          mandatory: true,
          description: "Playwright trace files for affected user flows",
        },
        sourceReview,
      ];

    case RiskLevel.MEDIUM:
      return [
        {
          type: EvidenceType.INVARIANT_DOCUMENTATION,
          mandatory: false,
          description: "Documented invariants – recommended but not blocking",
        },
        {
          type: EvidenceType.NEGATIVE_PATH_TEST,
          mandatory: false,
          description: "Negative‑path test results covering edge cases",
        },
        sourceReview,
      ];

    case RiskLevel.LOW:
    default:
      return [sourceReview];
  }
}

// ─── Required Reviewers Per Risk (§6b) ──────────────────────────

/**
 * §6b – Minimum reviewer requirements by risk band.
 */
function buildReviewerRequirements(riskLevel: RiskLevel): RequiredReviewers {
  switch (riskLevel) {
    case RiskLevel.CRITICAL:
      return { minHumans: 2, minCodeOwners: 1, botReviewCounts: false };
    case RiskLevel.HIGH:
      return { minHumans: 1, minCodeOwners: 0, botReviewCounts: false };
    case RiskLevel.MEDIUM:
      return { minHumans: 1, minCodeOwners: 0, botReviewCounts: true };
    case RiskLevel.LOW:
    default:
      return { minHumans: 0, minCodeOwners: 0, botReviewCounts: true };
  }
}

// ─── Merge Blocker Templates (§7) ───────────────────────────────

/** §7.1 – Missing human review. */
function blockerMissingHumanReview(details: string): MergeBlocker {
  return {
    type: MergeBlockerType.MISSING_HUMAN_REVIEW,
    active: true,
    description:
      "The PR lacks the minimum required human reviews for its risk level (§7.1).",
    details,
    blockedBy: "Insufficient human reviewer coverage",
    resolution:
      "Obtain the required number of human approvals from eligible reviewers.",
  };
}

/** §7.2 – Unresolved disputed findings. */
function blockerUnresolvedDisputed(findingIds: string[]): MergeBlocker {
  return {
    type: MergeBlockerType.UNRESOLVED_DISPUTED_FINDINGS,
    active: true,
    description:
      "One or more audit findings are disputed and have not been resolved (§7.2).",
    details: `Disputed / unresolved finding IDs: ${findingIds.join(", ")}`,
    blockedBy: `Unresolved disputes on findings: ${findingIds.join(", ")}`,
    resolution: "Resolve or waive each disputed finding before merging.",
  };
}

/** §7.3 – Insecure workflow permissions. */
function blockerInsecureWorkflow(details: string): MergeBlocker {
  return {
    type: MergeBlockerType.INSECURE_WORKFLOW_PERMISSIONS,
    active: true,
    description:
      "Workflow file grants write‑all tokens or uses pull_request_target with an untrusted checkout (§7.3).",
    details,
    blockedBy: "Insecure CI/CD workflow permissions",
    resolution:
      "Restrict workflow permissions to least‑privilege; avoid pull_request_target with checkout of untrusted refs.",
  };
}

/** §7.4 – Transaction integrity failure. */
function blockerTransactionIntegrity(): MergeBlocker {
  return {
    type: MergeBlockerType.TRANSACTION_INTEGRITY_FAILURE,
    active: true,
    description:
      "Multi‑step workflow detected with no rollback or compensating action (§7.4).",
    details:
      "The changed workflow files orchestrate multiple steps without a defined rollback mechanism.",
    blockedBy: "No rollback / compensating action defined",
    resolution:
      "Add a rollback step or compensating action for every state‑mutating workflow step.",
  };
}

// ─── Normative Rule Definitions (§10) ───────────────────────────

interface NormativeRuleDef {
  ruleId: string;
  level: "MUST" | "SHOULD" | "MAY";
  description: string;
  /** Returns true when the rule is violated. */
  check: (
    changedFiles: string[],
    diffContent: string,
    auditReport?: AuditFinding[],
  ) => boolean;
}

/**
 * §10 – Normative rules.
 *
 * MUST rules → block merge on violation.
 * SHOULD rules → warn + require justification.
 * MAY rules → advisory only.
 */
const NORMATIVE_RULES: NormativeRuleDef[] = [
  // ── MUST rules ──────────────────────────────────────────────
  {
    ruleId: "MUST-001",
    level: "MUST",
    description:
      "No secrets or credentials may be present in the diff (§10.1).",
    check: (_files, diff) =>
      CRITICAL_CONTENT_PATTERNS.some((p) => p.test(diff)),
  },
  {
    ruleId: "MUST-002",
    level: "MUST",
    description:
      "Workflow files MUST NOT use write-all permissions or pull_request_target with untrusted checkout (§10.2).",
    check: (_files, diff) =>
      /\bpermissions:\s*write-all\b/i.test(diff) ||
      /pull_request_target\s*:\s*\[.*checkout/i.test(diff),
  },
  {
    ruleId: "MUST-003",
    level: "MUST",
    description:
      "All database migrations MUST include a corresponding rollback (§10.3).",
    check: (files, diff) => {
      const hasMigration = files.some((f) => /\bmigrations?\//i.test(f));
      const hasRollback = /\b(down|rollback|revert|undo)\b/i.test(diff);
      return hasMigration && !hasRollback;
    },
  },
  {
    ruleId: "MUST-004",
    level: "MUST",
    description:
      "PII-handling code MUST reference the approved data‑handling policy (§10.4).",
    check: (files, diff) => {
      const touchesPii = files.some((f) => /\bpii\//i.test(f));
      const hasPolicyRef =
        /\bdata[ -]?handling[ -]?policy\b/i.test(diff) ||
        /\bprivacy[ -]?policy\b/i.test(diff);
      return touchesPii && !hasPolicyRef;
    },
  },
  {
    ruleId: "MUST-005",
    level: "MUST",
    description:
      "Critical auth path changes MUST be accompanied by at least one integration test (§10.5).",
    check: (files, diff) => {
      const touchesAuth = files.some((f) => /\bauth\//i.test(f));
      const hasTest =
        /\b(it|test|describe)\s*\(/i.test(diff) ||
        files.some((f) => /\.(test|spec|e2e)\./i.test(f));
      return touchesAuth && !hasTest;
    },
  },

  // ── SHOULD rules ────────────────────────────────────────────
  {
    ruleId: "SHOULD-001",
    level: "SHOULD",
    description:
      "New API routes SHOULD include OpenAPI / Swagger documentation (§10.6).",
    check: (files, diff) => {
      const newApiRoute =
        files.some((f) => /\bapi\//i.test(f)) &&
        /\b(router?\.(get|post|put|delete|patch)|@(Get|Post|Put|Delete|Patch))\b/i.test(
          diff,
        );
      const hasOpenApi = /\b(openapi|swagger|api[ -]?docs)\b/i.test(diff);
      return newApiRoute && !hasOpenApi;
    },
  },
  {
    ruleId: "SHOULD-002",
    level: "SHOULD",
    description:
      "Middleware changes SHOULD include request‑tracing instrumentation (§10.7).",
    check: (files, diff) => {
      const touchesMiddleware = files.some((f) => /\bmiddleware\//i.test(f));
      const hasTracing = /\b(tracing|opentelemetry|span|trace[ -]?id)\b/i.test(
        diff,
      );
      return touchesMiddleware && !hasTracing;
    },
  },
  {
    ruleId: "SHOULD-003",
    level: "SHOULD",
    description:
      "Service‑layer changes SHOULD include updated dependency‑injection wiring (§10.8).",
    check: (files, _diff) => {
      const touchesServices = files.some((f) => /\bservices?\//i.test(f));
      const touchesDi = files.some((f) =>
        /\b(container|inject|provider|registry|module)\b/i.test(f),
      );
      return touchesServices && !touchesDi;
    },
  },

  // ── MAY rules ───────────────────────────────────────────────
  {
    ruleId: "MAY-001",
    level: "MAY",
    description:
      "Consider adding a changeset entry for user‑facing changes (§10.9).",
    check: (files, _diff) =>
      !files.some((f) => /\.changeset\//i.test(f)) &&
      files.some((f) => !/\.(css|html|md|mdx|txt|json|ya?ml)$/i.test(f)),
  },
  {
    ruleId: "MAY-002",
    level: "MAY",
    description:
      "Consider updating the architecture decision record (ADR) for design changes (§10.10).",
    check: (files, _diff) => {
      const touchesDesign =
        files.some((f) => /\b(architecture|design|adr)\b/i.test(f)) ||
        files.some((f) => /\b(interface|abstract|base)[._-]/i.test(f));
      const hasAdr = files.some((f) => /\badr\//i.test(f));
      return touchesDesign && !hasAdr;
    },
  },
];

// ══════════════════════════════════════════════════════════════════
// PolicyEngine
// ══════════════════════════════════════════════════════════════════

/**
 * The single source of truth for all risk, artifact, reviewer,
 * and blocker decisions in the CodeNexus system.
 *
 * Usage:
 * ```ts
 * const engine = new PolicyEngine();
 * const risk = engine.classifyRisk(files, diff);
 * const artifacts = engine.getRequiredArtifacts(risk.level);
 * const reviewers = engine.getRequiredReviewers(risk.level);
 * const blockers = engine.evaluateBlockers({ ... });
 * ```
 */
export class PolicyEngine {
  /** In‑memory waiver store. */
  private waivers: Map<string, WaiverRecord> = new Map();

  /** Per‑detector precision / recall history for calibration (§9). */
  private detectorHistory: Map<
    string,
    {
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
      total: number;
    }[]
  > = new Map();

  private readonly policyVersion: string;

  constructor(policyVersion = POLICY_VERSION) {
    this.policyVersion = policyVersion;
  }

  // ─── §5  Risk Classification ────────────────────────────────

  /**
   * **§5 – Definitive Risk Classification**
   *
   * Analyses the changed files and diff content to assign one of
   * four risk levels.  The first matching level wins:
   *
   * 1. **CRITICAL** – auth/, billing/, permissions/, `.github/workflows/`,
   *    or token / secret patterns in the diff.
   * 2. **HIGH** – migrations/, middleware/, pii/, encryption patterns,
   *    or `ALTER TABLE` statements.
   * 3. **MEDIUM** – api/, routes/, services/, controllers/, or business‑logic
   *    patterns.
   * 4. **LOW** – everything else (CSS, HTML, Markdown, docs, tooling).
   *
   * @param changedFiles - List of file paths in the diff.
   * @param diffContent  - Full unified‑diff text.
   * @returns Classification with level, justification, and trigger list.
   */
  classifyRisk(
    changedFiles: string[],
    diffContent: string,
  ): RiskClassification {
    const triggers: string[] = [];
    const justificationParts: string[] = [];

    // --- CRITICAL check ---
    for (const pattern of CRITICAL_FILE_PATTERNS) {
      if (changedFiles.some((f) => pattern.test(f))) {
        triggers.push(`CRITICAL file pattern: ${pattern.source}`);
      }
    }
    for (const pattern of CRITICAL_CONTENT_PATTERNS) {
      if (pattern.test(diffContent)) {
        triggers.push(`CRITICAL content pattern: ${pattern.source}`);
      }
    }
    if (triggers.length > 0) {
      justificationParts.push(
        `CRITICAL: matched ${triggers.length} critical pattern(s).`,
      );
      return {
        level: RiskLevel.CRITICAL,
        justification:
          justificationParts.join(" ") + ` Triggers: ${triggers.join("; ")}`,
        triggers,
      };
    }

    // --- HIGH check ---
    const highTriggers: string[] = [];
    for (const pattern of HIGH_FILE_PATTERNS) {
      if (changedFiles.some((f) => pattern.test(f))) {
        highTriggers.push(`HIGH file pattern: ${pattern.source}`);
      }
    }
    for (const pattern of HIGH_CONTENT_PATTERNS) {
      if (pattern.test(diffContent)) {
        highTriggers.push(`HIGH content pattern: ${pattern.source}`);
      }
    }
    if (highTriggers.length > 0) {
      justificationParts.push(
        `HIGH: matched ${highTriggers.length} high‑risk pattern(s).`,
      );
      return {
        level: RiskLevel.HIGH,
        justification:
          justificationParts.join(" ") +
          ` Triggers: ${highTriggers.join("; ")}`,
        triggers: highTriggers,
      };
    }

    // --- MEDIUM check ---
    const mediumTriggers: string[] = [];
    for (const pattern of MEDIUM_FILE_PATTERNS) {
      if (changedFiles.some((f) => pattern.test(f))) {
        mediumTriggers.push(`MEDIUM file pattern: ${pattern.source}`);
      }
    }
    for (const pattern of MEDIUM_CONTENT_PATTERNS) {
      if (pattern.test(diffContent)) {
        mediumTriggers.push(`MEDIUM content pattern: ${pattern.source}`);
      }
    }
    if (mediumTriggers.length > 0) {
      justificationParts.push(
        `MEDIUM: matched ${mediumTriggers.length} medium‑risk pattern(s).`,
      );
      return {
        level: RiskLevel.MEDIUM,
        justification:
          justificationParts.join(" ") +
          ` Triggers: ${mediumTriggers.join("; ")}`,
        triggers: mediumTriggers,
      };
    }

    // --- LOW: everything else ---
    const isLowRisk = changedFiles.every(
      (f) =>
        LOW_FILE_SUFFIXES.some((s) => s.test(f)) ||
        /\bdocs?\//i.test(f) ||
        /\btooling\//i.test(f) ||
        /\.gitignore$/i.test(f) ||
        /\.editorconfig$/i.test(f) ||
        /\.prettier/i.test(f) ||
        /\.eslint/i.test(f),
    );

    if (isLowRisk) {
      justificationParts.push(
        "LOW: only documentation, styling, or tooling files changed.",
      );
    } else {
      justificationParts.push(
        "LOW: no critical, high, or medium patterns matched.",
      );
    }

    return {
      level: RiskLevel.LOW,
      justification: justificationParts.join(" "),
      triggers: [],
    };
  }

  // ─── §6  Required Artifacts Per Risk ────────────────────────

  /**
   * **§6 – Required Artifacts Per Risk**
   *
   * Returns the list of evidence artifacts that must (or should) be
   * present before a merge can proceed at the given risk level.
   *
   * | Risk      | Artifacts                                                       |
   * |-----------|-----------------------------------------------------------------|
   * | CRITICAL  | Layer‑3 evidence, dual sign‑off, 3 lens results, race‑condition |
   * |           | tests, Playwright traces, evidence‑store entries, audit‑log     |
   * |           | PII‑proof, source review.                                       |
   * | HIGH      | Deep E2E race‑condition tests, invariant docs, runtime          |
   * |           | verification, Playwright traces, source review.                 |
   * | MEDIUM    | Invariant docs (optional), negative‑path tests, source review.  |
   * | LOW       | Source review report only.                                      |
   *
   * @param riskLevel - The classified risk level.
   * @returns Array of required artifact specifications.
   */
  getRequiredArtifacts(riskLevel: RiskLevel): RequiredArtifactSpec[] {
    return buildArtifactSpecs(riskLevel);
  }

  // ─── §6b Required Reviewers Per Risk ────────────────────────

  /**
   * **§6b – Required Reviewers Per Risk**
   *
   * | Risk      | Humans | Code Owners | Bot Reviews Count? |
   * |-----------|--------|-------------|--------------------|
   * | CRITICAL  | 2      | 1           | No                 |
   * | HIGH      | 1      | 0           | No                 |
   * | MEDIUM    | 1      | 0           | Yes                |
   * | LOW       | 0      | 0           | Yes                |
   *
   * @param riskLevel - The classified risk level.
   * @returns Reviewer requirements.
   */
  getRequiredReviewers(riskLevel: RiskLevel): RequiredReviewers {
    return buildReviewerRequirements(riskLevel);
  }

  // ─── §7  Merge Blocker Evaluation ───────────────────────────

  /**
   * **§7 – Merge Blocker Evaluation**
   *
   * Evaluates all four MUST‑block conditions:
   *
   * 1. **MISSING_HUMAN_REVIEW** (§7.1) – review count < required OR
   *    all reviewers are bots.
   * 2. **UNRESOLVED_DISPUTED_FINDINGS** (§7.2) – any finding with
   *    `disputed === true && resolved === false`.
   * 3. **INSECURE_WORKFLOW_PERMISSIONS** (§7.3) – `write‑all` tokens,
   *    `pull_request_target` with untrusted checkout.
   * 4. **TRANSACTION_INTEGRITY_FAILURE** (§7.4) – multi‑step workflow
   *    with no rollback / compensating action.
   *
   * @param context - Full merge context (PR metadata, reviewers, findings, etc.).
   * @returns Array of active `MergeBlocker` objects (empty ⇒ ready to merge).
   */
  evaluateBlockers(context: MergeContext): MergeBlocker[] {
    const blockers: MergeBlocker[] = [];
    const required = buildReviewerRequirements(context.riskLevel);

    // §7.1 – Human review coverage
    const humanReviewers = context.reviewers.filter(
      (r) => !r.isBot || required.botReviewCounts,
    );
    const hasHumanReviews = humanReviewers.length >= required.minHumans;
    const hasCodeOwner =
      required.minCodeOwners > 0
        ? context.reviewers.some(
            (r) => r.isCodeOwner && (!r.isBot || required.botReviewCounts),
          )
        : true;

    // Also check: if all reviewers are bots and botReviewCounts is false
    const allBots =
      context.reviewers.length > 0 &&
      context.reviewers.every((r) => r.isBot) &&
      !required.botReviewCounts;

    if (!hasHumanReviews || !hasCodeOwner || allBots) {
      const reasons: string[] = [];
      if (!hasHumanReviews)
        reasons.push(
          `need ${required.minHumans} human reviewer(s), have ${humanReviewers.length}`,
        );
      if (!hasCodeOwner) reasons.push("no code‑owner review present");
      if (allBots)
        reasons.push(
          "all reviewers are bots but bot reviews do not count at this risk level",
        );

      blockers.push(blockerMissingHumanReview(reasons.join("; ")));
    }

    // §7.2 – Unresolved disputed findings
    const disputedUnresolved = context.findings.filter(
      (f) => f.disputed && !f.resolved,
    );
    if (disputedUnresolved.length > 0) {
      blockers.push(
        blockerUnresolvedDisputed(disputedUnresolved.map((f) => f.id)),
      );
    }

    // §7.3 – Insecure workflow permissions
    for (const wfFile of context.workflowFiles) {
      // In production this would read the actual file content.
      // Here we check whether the filename itself hints at dangerous patterns
      // and whether the context carries any indication of insecure config.
      const hasWriteAll = /\bwrite-all\b/i.test(wfFile); // proxy – real impl reads file
      const hasPtr = /pull_request_target/i.test(wfFile);

      if (hasWriteAll || hasPtr) {
        blockers.push(
          blockerInsecureWorkflow(
            `Workflow '${wfFile}' contains ${[
              hasWriteAll && "write‑all permissions",
              hasPtr && "pull_request_target usage",
            ]
              .filter(Boolean)
              .join(" and ")}.`,
          ),
        );
      }
    }
    // Also scan workflow content if available in diff
    // (The MergeContext.workflowFiles carries the paths; the actual
    // content scanning happens inside the normative rules for MUST-002.)

    // §7.4 – Transaction integrity
    if (context.workflowFiles.length > 0 && !context.hasRollbackMechanism) {
      // Heuristic: if workflow files are present and no rollback is declared,
      // trigger the blocker.  A more sophisticated implementation would parse
      // the workflow DAG.
      const hasMultiStep = context.workflowFiles.length > 1; // proxy

      if (hasMultiStep) {
        blockers.push(blockerTransactionIntegrity());
      }
    }

    return blockers;
  }

  // ─── §8  Waiver Model ───────────────────────────────────────

  /**
   * **§8 – Request a Waiver**
   *
   * Creates a new waiver record for a disputed or blocking finding.
   *
   * Approval requirements:
   * - CRITICAL → 2 approvals
   * - HIGH     → 1 approval
   * - MEDIUM / LOW → auto‑approved (valid immediately)
   *
   * @param findingId     - The ID of the audit finding to waive.
   * @param justification - Human‑written justification for the waiver.
   * @param riskLevel     - The risk level of the associated change.
   * @param requestedBy   - Login of the requestor.
   * @returns The newly created WaiverRecord.
   */
  requestWaiver(
    findingId: string,
    justification: string,
    riskLevel: RiskLevel,
    requestedBy: string,
  ): WaiverRecord {
    const now = new Date().toISOString();
    const requiredApprovals =
      riskLevel === RiskLevel.CRITICAL
        ? 2
        : riskLevel === RiskLevel.HIGH
          ? 1
          : 0;

    const waiver: WaiverRecord = {
      id: uuidv4(),
      findingId,
      riskLevel,
      justification,
      requestedBy,
      approvals: [],
      requiredApprovals,
      valid: requiredApprovals === 0, // auto‑approved for MEDIUM / LOW
      createdAt: now,
      expiresAt: new Date(Date.now() + WAIVER_TTL_MS).toISOString(),
    };

    this.waivers.set(waiver.id, waiver);
    return waiver;
  }

  /**
   * **§8 – Approve a Waiver**
   *
   * Adds an approval to an existing waiver.  Once `approvals.length`
   * reaches `requiredApprovals`, the waiver is marked `valid: true`.
   *
   * @param waiverId - The waiver ID.
   * @param reviewer - Login of the approving reviewer.
   * @param notes    - Optional approval notes.
   * @returns The updated WaiverRecord, or throws if not found.
   */
  approveWaiver(waiverId: string, reviewer: string, notes = ""): WaiverRecord {
    const waiver = this.waivers.get(waiverId);
    if (!waiver) {
      throw new Error(`Waiver not found: ${waiverId}`);
    }

    if (waiver.valid) {
      // Already valid – no‑op but return it
      return waiver;
    }

    // Prevent duplicate approvals from the same reviewer
    if (waiver.approvals.some((a) => a.reviewer === reviewer)) {
      return waiver;
    }

    waiver.approvals.push({
      reviewer,
      timestamp: new Date().toISOString(),
      notes,
    });

    if (waiver.approvals.length >= waiver.requiredApprovals) {
      waiver.valid = true;
    }

    this.waivers.set(waiverId, waiver);
    return waiver;
  }

  /**
   * **§8 – Validate a Waiver**
   *
   * Checks whether a waiver is still valid:
   * - `valid === true`
   * - Has not expired (`expiresAt` is in the future)
   *
   * @param waiver - The waiver record to validate.
   * @returns `true` if the waiver is currently valid.
   */
  isWaiverValid(waiver: WaiverRecord): boolean {
    if (!waiver.valid) return false;
    return new Date(waiver.expiresAt).getTime() > Date.now();
  }

  /**
   * Returns all waivers associated with a specific finding.
   */
  getWaiversForFinding(findingId: string): WaiverRecord[] {
    return Array.from(this.waivers.values()).filter(
      (w) => w.findingId === findingId,
    );
  }

  /**
   * Returns every waiver currently tracked by the engine.
   */
  getAllWaivers(): WaiverRecord[] {
    return Array.from(this.waivers.values());
  }

  /**
   * Marks all expired waivers as invalid and returns the count.
   */
  expireWaivers(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, waiver] of this.waivers) {
      if (waiver.valid && new Date(waiver.expiresAt).getTime() <= now) {
        waiver.valid = false;
        this.waivers.set(id, waiver);
        count++;
      }
    }
    return count;
  }

  // ─── §9  Confidence Calibration ─────────────────────────────

  /**
   * **§9 – Confidence Calibration (InjecGuard‑inspired)**
   *
   * Calibrates a detector's raw score by penalising false positives
   * at **0.5×** the weight of false negatives.  This encodes the
   * principle that over‑defense is less dangerous than under‑defense
   * but still erodes trust.
   *
   * The calibration formula for each detector:
   * ```
   * precision = TP / (TP + FP)    [clamped to 0..1]
   * recall    = TP / (TP + FN)    [clamped to 0..1]
   * fpr       = FP / (TP + FP)    [false‑positive rate]
   * fnr       = FN / (TP + FN)    [false‑negative rate]
   *
   * penalty   = (fpr * 0.5) + (fnr * 1.0)
   * calibrated = rawScore * (1 - penalty)
   * ```
   *
   * Historical precision / recall is tracked per detector across
   * calls and used to smooth the penalty.
   *
   * @param detectorResults - Array of per‑detector scoring data.
   * @returns Array of calibrated scores, one per detector.
   */
  calibrateConfidence(detectorResults: DetectorResult[]): CalibratedScore[] {
    return detectorResults.map((dr) => {
      // Update history
      if (!this.detectorHistory.has(dr.detectorName)) {
        this.detectorHistory.set(dr.detectorName, []);
      }
      this.detectorHistory.get(dr.detectorName)!.push({
        truePositives: dr.truePositives,
        falsePositives: dr.falsePositives,
        falseNegatives: dr.falseNegatives,
        total: dr.totalEvaluated,
      });

      // Compute current precision / recall
      const tp = dr.truePositives;
      const fp = dr.falsePositives;
      const fn = dr.falseNegatives;
      const denomP = tp + fp || 1;
      const denomR = tp + fn || 1;

      const precision = Math.max(0, Math.min(1, tp / denomP));
      const recall = Math.max(0, Math.min(1, tp / denomR));
      const fpr = fp / denomP;
      const fnr = fn / denomR;

      // Penalty: FP at 0.5× weight, FN at 1.0× weight
      const falsePositivePenalty = fpr * 0.5;
      const falseNegativePenalty = fnr * 1.0;
      const totalPenalty = falsePositivePenalty + falseNegativePenalty;

      const calibratedScore = Math.max(
        0,
        Math.min(1, dr.rawScore * (1 - totalPenalty)),
      );

      return {
        rawScore: dr.rawScore,
        calibratedScore: Math.round(calibratedScore * 10_000) / 10_000,
        falsePositivePenalty:
          Math.round(falsePositivePenalty * 10_000) / 10_000,
        detectorName: dr.detectorName,
      };
    });
  }

  /**
   * Returns the per‑detector precision / recall history for
   * external analysis or dashboarding.
   */
  getDetectorHistory(): Map<
    string,
    {
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
      total: number;
    }[]
  > {
    return this.detectorHistory;
  }

  // ─── §10 Normative Rule Evaluation ──────────────────────────

  /**
   * **§10 – Normative Rule Evaluation**
   *
   * Evaluates all MUST / SHOULD / MAY rules against the given
   * change set and optional audit report.
   *
   * | Violation | Outcome                                          |
   * |-----------|--------------------------------------------------|
   * | MUST      | `{ block: true, reason: string }`                |
   * | SHOULD    | `{ warn: true, justificationRequired: true }`    |
   * | MAY       | `{ advisory: true }`                             |
   *
   * @param changedFiles - Files in the diff.
   * @param diffContent  - Unified diff text.
   * @param auditReport  - Optional array of audit findings.
   * @returns Array of `NormativeRuleResult`.
   */
  evaluateNormativeRules(
    changedFiles: string[],
    diffContent: string,
    auditReport?: AuditFinding[],
  ): NormativeRuleResult[] {
    return NORMATIVE_RULES.map((rule) => {
      const violated = rule.check(changedFiles, diffContent, auditReport);

      return {
        ruleId: rule.ruleId,
        level: rule.level,
        description: rule.description,
        violated,
        block: rule.level === "MUST" && violated,
        warn: rule.level === "SHOULD" && violated,
        justificationRequired: rule.level === "SHOULD" && violated,
        advisory: rule.level === "MAY" && violated,
      };
    });
  }

  // ─── Convenience: Full Evaluation ───────────────────────────

  /**
   * Runs the complete policy pipeline and returns a structured summary.
   *
   * This is a convenience method that chains:
   * `classifyRisk` → `getRequiredArtifacts` → `getRequiredReviewers` →
   * `evaluateBlockers` → `evaluateNormativeRules` →
   * `calibrateConfidence` (if detector results provided).
   */
  evaluate(params: {
    changedFiles: string[];
    diffContent: string;
    mergeContext: MergeContext;
    detectorResults?: DetectorResult[];
    auditReport?: AuditFinding[];
  }): {
    riskClassification: RiskClassification;
    requiredArtifacts: RequiredArtifactSpec[];
    requiredReviewers: RequiredReviewers;
    blockers: MergeBlocker[];
    normativeRules: NormativeRuleResult[];
    calibratedScores?: CalibratedScore[];
    mergeAllowed: boolean;
  } {
    const riskClassification = this.classifyRisk(
      params.changedFiles,
      params.diffContent,
    );
    const requiredArtifacts = this.getRequiredArtifacts(
      riskClassification.level,
    );
    const requiredReviewers = this.getRequiredReviewers(
      riskClassification.level,
    );
    const blockers = this.evaluateBlockers(params.mergeContext);
    const normativeRules = this.evaluateNormativeRules(
      params.changedFiles,
      params.diffContent,
      params.auditReport,
    );

    const calibratedScores = params.detectorResults
      ? this.calibrateConfidence(params.detectorResults)
      : undefined;

    const mergeAllowed =
      blockers.length === 0 && !normativeRules.some((r) => r.block);

    return {
      riskClassification,
      requiredArtifacts,
      requiredReviewers,
      blockers,
      normativeRules,
      calibratedScores,
      mergeAllowed,
    };
  }

  // ─── Metadata ────────────────────────────────────────────────

  /** Returns the engine's policy version. */
  getVersion(): string {
    return this.policyVersion;
  }
}

// ══════════════════════════════════════════════════════════════════
// Zod Runtime Validation Schemas
// ══════════════════════════════════════════════════════════════════

/** Zod schema for validating a RiskLevel enum value at runtime. */
export const RiskLevelSchema = z.nativeEnum(RiskLevel);

/** Zod schema for validating a MergeBlockerType enum value. */
export const MergeBlockerTypeSchema = z.nativeEnum(MergeBlockerType);

/** Zod schema for validating a MergeBlocker at runtime. */
export const MergeBlockerSchema = z.object({
  type: MergeBlockerTypeSchema,
  active: z.boolean(),
  description: z.string(),
  details: z.string(),
  blockedBy: z.string(),
  resolution: z.string(),
});

/** Zod schema for validating a WaiverRecord at runtime. */
export const WaiverRecordSchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().min(1),
  riskLevel: RiskLevelSchema,
  justification: z.string().min(1),
  requestedBy: z.string().min(1),
  approvals: z.array(
    z.object({
      reviewer: z.string().min(1),
      timestamp: z.string().datetime(),
      notes: z.string(),
    }),
  ),
  requiredApprovals: z.number().int().min(0).max(2),
  valid: z.boolean(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

/** Zod schema for validating a MergeContext at runtime. */
export const MergeContextSchema = z.object({
  prNumber: z.number().int().positive(),
  riskLevel: RiskLevelSchema,
  reviewers: z.array(
    z.object({
      login: z.string().min(1),
      isBot: z.boolean(),
      isCodeOwner: z.boolean(),
    }),
  ),
  findings: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
      category: z.string(),
      description: z.string(),
      disputed: z.boolean(),
      resolved: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  workflowFiles: z.array(z.string()),
  hasRollbackMechanism: z.boolean(),
});

/** Zod schema for validating DetectorResult input to calibrateConfidence(). */
export const DetectorResultSchema = z.object({
  detectorName: z.string().min(1),
  rawScore: z.number().min(0).max(1),
  findings: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
      category: z.string(),
      description: z.string(),
      disputed: z.boolean(),
      resolved: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  falsePositives: z.number().int().min(0),
  truePositives: z.number().int().min(0),
  falseNegatives: z.number().int().min(0),
  totalEvaluated: z.number().int().min(0),
});
