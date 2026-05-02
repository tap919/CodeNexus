/**
 * CodeNexus Review Components — Vibe Coder Augmentation
 *
 * Two components that transform automated code review from raw findings
 * into honest, human-readable decision support:
 *
 * 1. BlindSpotDeclaration — "What might we still be wrong about?"
 * 2. BuildImpactTranslator — "What does this actually mean for your build?"
 */

import { v4 as uuid } from "uuid";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ReviewSection =
  | "Authorization Review"
  | "Race Conditions"
  | "Business Logic"
  | "Workflow Integrity"
  | "Source-to-Sink Tracing"
  | "Pipeline Security"
  | "Design Review"
  | "Knowledge Retrieval"
  | "Secrets Detection"
  | "Prompt Injection"
  | "Data Exfiltration"
  | "Transaction Integrity"
  | "CI/CD Workflow Audit"
  | "Dependency Supply Chain";

export interface BlindSpotDeclaration {
  /** Unique identifier for this blind spot block */
  id: string;
  /** The risk level of the section this declaration belongs to */
  riskLevel: RiskLevel;
  /** Which review section generated this */
  section: ReviewSection;
  /** Number of automated findings in this section */
  automatedFindingsCount: number;
  /** Specific things the automated system knows it might miss */
  thingsSystemMightMiss: string[];
  /** 0-100 confidence score based on coverage depth, test maturity, known limits */
  confidenceScore: number;
  /** Exactly one human focus area — what the human should verify */
  recommendedHumanFocus: string;
  /** Why these gaps exist — limitation of the approach, not an excuse */
  systemLimitNote: string;
}

export interface BuildImpactTranslator {
  /** Unique escalation ID, format ESC-YYYY-NNNN */
  escalationId: string;
  /** Category of the finding that triggered escalation */
  findingCategory: string;
  /** One-sentence technical summary */
  technicalSummary: string;
  /** Human-readable translation */
  laymensTranslation: {
    /** What this finding means in plain language */
    whatThisMeans: string;
    /** Scope of impact mapping */
    scopeOfImpact: {
      /** Which build components are affected */
      affectedBuildComponents: string[];
      /** Path from feature to user-facing consequence */
      userJourneyImpact: string;
      /** Data integrity risk description */
      dataIntegrityRisk: string;
    };
    /** Decision implications */
    implications: {
      /** What happens if this is ignored */
      ifIgnored: string;
      /** What happens if fixed now */
      ifFixedNow: string;
      /** Estimated effort level */
      effortToFix: string;
    };
    /** Quantified impact percentages across build dimensions */
    impactPercentages: {
      /** e.g., "15% risk of flaky checkout under load" */
      buildStability: string;
      /** Security posture impact */
      securityPosture: string;
      /** User trust impact */
      userTrust: string;
      /** Operational overhead impact */
      operationalOverhead: string;
    };
  };
  /** Recommended actions (ordered by priority) */
  recommendedActions: string[];
  /** 2-3 decision options for the human reviewer */
  humanDecisionOptions: HumanDecisionOption[];
}

export interface HumanDecisionOption {
  /** Type: APPROVE_WITH_FIX, APPROVE_WITH_TICKET, REJECT */
  type: "APPROVE_WITH_FIX" | "APPROVE_WITH_TICKET" | "REJECT";
  /** Human-readable description of this option */
  description: string;
  /** Consequence of choosing this option */
  consequence: string;
}

// ═══════════════════════════════════════════════════════════════
// BlindSpot Knowledge Base
// ═══════════════════════════════════════════════════════════════

/**
 * System-aware limitations per review section.
 * Each entry represents what the static/deterministic analysis
 * CANNOT prove and why the human must fill the gap.
 */
const BLIND_SPOT_KNOWLEDGE: Record<ReviewSection, {
  baseConfidence: number;
  thingsSystemMightMiss: string[];
  systemLimitNote: string;
}> = {
  "Authorization Review": {
    baseConfidence: 72,
    thingsSystemMightMiss: [
      "Business logic bypasses that require domain knowledge (e.g., a 'pending' status that should block deletion but doesn't)",
      "IDOR vulnerabilities across multi-tenant boundaries when object IDs are predictable but not directly exposed in this diff",
      "Authorization checks added to the controller but missing in downstream service calls",
      "Role escalation through indirect reference chains (e.g., modifying a team ID to gain admin access to another team's data)",
      "Time-of-check to time-of-use race conditions in permission checks under high concurrency",
    ],
    systemLimitNote:
      "Authorization logic is statically analyzable, but role-transition graphs and indirect privilege escalation require runtime verification.",
  },
  "Race Conditions": {
    baseConfidence: 58,
    thingsSystemMightMiss: [
      "Distributed race conditions across multiple services or database replicas",
      "Second-order race conditions where Event A and Event B are individually safe but interleave dangerously",
      "Business invariants that hold under test load but fail under production traffic patterns",
      "Client-side retry storms that bypass server-side debouncing",
      "Database deadlock scenarios in complex transactions that only appear under specific isolation levels",
    ],
    systemLimitNote:
      "Race conditions require concurrent execution scenarios; static analysis and unit tests cannot fully validate interleaving behavior.",
  },
  "Business Logic": {
    baseConfidence: 65,
    thingsSystemMightMiss: [
      "Domain-specific validation rules that aren't expressed in code (e.g., 'Free users can't export more than 3 reports per month')",
      "Edge cases in coupon/promotion stacking that depend on business calendar events",
      "Workflow states that are valid in code but nonsensical in business context",
      "Implicit invariants that developers assume but never encode",
      "Multi-step workflows where partial completion is acceptable in some contexts but not others",
    ],
    systemLimitNote:
      "Business logic correctness depends on domain knowledge; code structure alone cannot verify semantic validity.",
  },
  "Workflow Integrity": {
    baseConfidence: 67,
    thingsSystemMightMiss: [
      "Process timing attacks (e.g., rapid-fire coupon claims within the same millisecond)",
      "Limits on function reuse that span multiple services (e.g., referral bonus across different microservices)",
      "Handoff tampering between internal systems where validation is split across teams",
      "Orphaned states after partial failure in long-running sagas",
      "State-machine gaps that only appear under specific failure modes",
    ],
    systemLimitNote:
      "Workflow integrity across distributed systems requires end-to-end tracing; static analysis sees only intra-service transitions.",
  },
  "Source-to-Sink Tracing": {
    baseConfidence: 74,
    thingsSystemMightMiss: [
      "Data flows through third-party libraries that mutate data before it reaches sinks",
      "Indirect data leakage through error messages, stack traces in responses, or timing side channels",
      "Logging paths that are dynamically generated or use reflection",
      "Cached data that bypasses validation on cache-hit paths",
      "Data transformations in middleware that aren't visible in the controller/service layer",
    ],
    systemLimitNote:
      "Static data-flow tracing sees explicit assignments; runtime dispatch, reflection, and library internals are opaque.",
  },
  "Pipeline Security": {
    baseConfidence: 80,
    thingsSystemMightMiss: [
      "Third-party GitHub Actions with transitive dependency compromises",
      "Secrets exposed in job logs through debug output or verbose error messages",
      "Workflow dispatch inputs that can be manipulated from forks",
      "OIDC token misuse in cloud-deployment steps that grant broader access than intended",
      "Artifact poisoning across workflow runs where one job's output contaminates another",
    ],
    systemLimitNote:
      "Pipeline configuration analysis can verify structure; runtime behavior and third-party action internals require execution monitoring.",
  },
  "Design Review": {
    baseConfidence: 55,
    thingsSystemMightMiss: [
      "Color contrast issues that pass automated tools but fail human perception tests",
      "Interaction patterns that are accessible but confusing (e.g., a button that looks disabled but isn't)",
      "Responsive breakpoints that work at tested sizes but break at in-between widths",
      "Animation performance on low-end devices or under battery-saving modes",
      "Content layout issues with dynamic text lengths in non-English locales",
    ],
    systemLimitNote:
      "Automated design review checks structural properties; human perception and real-device testing remain essential.",
  },
  "Knowledge Retrieval": {
    baseConfidence: 48,
    thingsSystemMightMiss: [
      "Outdated vendor documentation that contradicts current API behavior",
      "Community solutions that work in isolation but introduce subtle bugs in the current codebase",
      "Retrieved content that is factually correct but contextually inappropriate for this codebase",
      "Tier-3 sources that have been SEO-optimized to appear authoritative but contain dangerous patterns",
      "Conflicting advice from equally-credible sources that requires architectural judgment",
    ],
    systemLimitNote:
      "Retrieval is evidence, not authority. Trust-tier tagging reduces risk but cannot replace human judgment on relevance.",
  },
  "Secrets Detection": {
    baseConfidence: 82,
    thingsSystemMightMiss: [
      "Secrets split across multiple lines or concatenated at runtime",
      "Encrypted secrets that are decrypted with a key also present in the codebase",
      "Environment-specific secrets that only appear in deployment configs, not source code",
      "Derived credentials generated from API responses and cached inappropriately",
      "Secrets in binary files, images, or compiled artifacts",
    ],
    systemLimitNote:
      "Pattern-based secret detection is strong for known formats; obfuscated or derived credentials require runtime scanning.",
  },
  "Prompt Injection": {
    baseConfidence: 70,
    thingsSystemMightMiss: [
      "Multi-turn injection attacks that build context across several interactions",
      "Injection through structured data formats (JSON, XML, YAML) that the agent processes as input",
      "Prompt leakage through carefully crafted benign-looking requests",
      "Indirect injection through tool outputs that contain attacker-controlled content",
      "Encoding tricks that bypass pattern-based filters (Unicode homoglyphs, RTL override, zero-width characters)",
    ],
    systemLimitNote:
      "Heuristic detection catches known patterns; novel attack vectors and multi-turn attacks require LLM-level analysis and canary monitoring.",
  },
  "Data Exfiltration": {
    baseConfidence: 75,
    thingsSystemMightMiss: [
      "Exfiltration through timing channels (varying response times to encode data bit-by-bit)",
      "Data stuffed into image metadata, DNS queries, or other out-of-band channels",
      "Slow, low-volume exfiltration that stays under rate limits and baseline thresholds",
      "Exfiltration disguised as legitimate API calls to allowed destinations",
      "Compressed/encrypted data that passes pattern checks but contains sensitive payloads",
    ],
    systemLimitNote:
      "Volume and pattern-based detection works for bulk exfiltration; sophisticated exfiltration requires behavioral analysis over long time windows.",
  },
  "Transaction Integrity": {
    baseConfidence: 60,
    thingsSystemMightMiss: [
      "Partial failures in distributed transactions where the coordinator crashes mid-commit",
      "Compensating transactions that themselves fail, creating compounding inconsistency",
      "Eventual-consistency windows where stale reads cause incorrect business decisions",
      "Idempotency gaps under network partition scenarios",
      "Cross-database transactions where each DB uses a different isolation level",
    ],
    systemLimitNote:
      "Transaction integrity analysis sees explicit commit/rollback patterns; distributed saga orchestration and isolation-level interactions require chaos testing.",
  },
  "CI/CD Workflow Audit": {
    baseConfidence: 78,
    thingsSystemMightMiss: [
      "AI-generated workflow steps that execute untrusted PR content without validation",
      "Reusable workflows from external repositories that have been compromised",
      "Self-hosted runners with persistent state that leaks between jobs",
      "Environment protection rules that are bypassed through deployment approval chaining",
      "Secrets accessible to workflow_dispatch events from untrusted branches",
    ],
    systemLimitNote:
      "Workflow YAML analysis checks structural safety; runtime AI-agent interactions and self-hosted runner state require execution monitoring.",
  },
  "Dependency Supply Chain": {
    baseConfidence: 68,
    thingsSystemMightMiss: [
      "Transitive dependencies that introduce vulnerabilities 3+ levels deep",
      "Package typosquatting where the malicious package has the same API surface",
      "Build-time dependency compromises that inject code during compilation",
      "Dual-use packages that are safe in one context but dangerous when combined",
      "Protestware and maintainer-account compromises that activate after a time delay",
    ],
    systemLimitNote:
      "Supply chain analysis checks known vulnerabilities and metadata; novel attacks and deep-transitive risks require runtime monitoring and SBOM verification.",
  },
};

// ═══════════════════════════════════════════════════════════════
// BlindSpotDeclaration Generator
// ═══════════════════════════════════════════════════════════════

/**
 * Generates a BlindSpotDeclaration for a given review section.
 *
 * MUST appear after every review section that has automated findings.
 * May be collapsed for LOW risk sections.
 *
 * @param section - The review section to generate for
 * @param findingsCount - Number of automated findings in that section
 * @param riskLevel - Risk level from the policy engine
 */
export function generateBlindSpot(
  section: ReviewSection,
  findingsCount: number,
  riskLevel: RiskLevel,
): BlindSpotDeclaration {
  const knowledge = BLIND_SPOT_KNOWLEDGE[section];

  // Adjust confidence based on findings count and risk level
  let confidenceScore = knowledge.baseConfidence;
  if (findingsCount > 5) confidenceScore -= 10; // More findings = more uncertainty
  if (riskLevel === "CRITICAL") confidenceScore -= 8;
  if (riskLevel === "HIGH") confidenceScore -= 4;

  // Clamp
  confidenceScore = Math.max(10, Math.min(99, confidenceScore));

  // Select the most relevant blind spots (limit to 5)
  const thingsSystemMightMiss = knowledge.thingsSystemMightMiss.slice(0, 5);

  // Choose human focus based on section
  const humanFocusMap: Partial<Record<ReviewSection, string>> = {
    "Authorization Review":
      "Verify every role transition path and test with cross-tenant data.",
    "Race Conditions":
      "Run concurrent load tests and verify rollback behavior under partial failure.",
    "Business Logic":
      "Walk through the happy path and 3 failure paths manually; check domain invariants.",
    "Workflow Integrity":
      "Trace each state transition end-to-end; verify compensating actions for every failure mode.",
    "Source-to-Sink Tracing":
      "Trace one complete data flow from input to all sinks; verify no unexpected data surfaces in logs.",
    "Transaction Integrity":
      "Test with network partition simulation; verify every multi-step operation has a rollback path.",
  };

  return {
    id: `BSD-${uuid().slice(0, 8)}`,
    riskLevel,
    section,
    automatedFindingsCount: findingsCount,
    thingsSystemMightMiss,
    confidenceScore,
    recommendedHumanFocus:
      humanFocusMap[section] ??
      `Review the ${findingsCount} automated finding(s) and verify they represent real issues, not false positives.`,
    systemLimitNote: knowledge.systemLimitNote,
  };
}

/**
 * Generates BlindSpotDeclarations for all relevant sections.
 * Skips sections with zero findings.
 */
export function generateAllBlindSpots(
  sectionFindings: Map<ReviewSection, { count: number; riskLevel: RiskLevel }>,
): BlindSpotDeclaration[] {
  const blindSpots: BlindSpotDeclaration[] = [];

  for (const [section, { count, riskLevel }] of sectionFindings) {
    if (count === 0 && riskLevel === "LOW") continue;
    blindSpots.push(generateBlindSpot(section, count, riskLevel));
  }

  return blindSpots.sort((a, b) => {
    const riskOrder: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
  });
}

// ═══════════════════════════════════════════════════════════════
// BuildImpactTranslator Generator
// ═══════════════════════════════════════════════════════════════

/**
 * Translates a technical finding into a vibe-coder decision card.
 *
 * MUST appear for every ESCALATE or FAIL decision.
 * MUST include exactly one "what this means" paragraph, scope map,
 * implications trio, and impact percentages.
 */
export function translateFinding(
  escalationId: string,
  findingCategory: string,
  technicalSummary: string,
  overrides?: Partial<BuildImpactTranslator["laymensTranslation"]>,
): BuildImpactTranslator {
  const template = IMPACT_TEMPLATES[findingCategory] ?? IMPACT_TEMPLATES["Generic Finding"];

  return {
    escalationId,
    findingCategory,
    technicalSummary,
    laymensTranslation: {
      whatThisMeans: overrides?.whatThisMeans ?? template.whatThisMeans,
      scopeOfImpact: {
        affectedBuildComponents:
          overrides?.scopeOfImpact?.affectedBuildComponents ??
          template.scopeOfImpact.affectedBuildComponents,
        userJourneyImpact:
          overrides?.scopeOfImpact?.userJourneyImpact ??
          template.scopeOfImpact.userJourneyImpact,
        dataIntegrityRisk:
          overrides?.scopeOfImpact?.dataIntegrityRisk ??
          template.scopeOfImpact.dataIntegrityRisk,
      },
      implications: {
        ifIgnored: overrides?.implications?.ifIgnored ?? template.implications.ifIgnored,
        ifFixedNow: overrides?.implications?.ifFixedNow ?? template.implications.ifFixedNow,
        effortToFix: overrides?.implications?.effortToFix ?? template.implications.effortToFix,
      },
      impactPercentages: {
        buildStability:
          overrides?.impactPercentages?.buildStability ??
          template.impactPercentages.buildStability,
        securityPosture:
          overrides?.impactPercentages?.securityPosture ??
          template.impactPercentages.securityPosture,
        userTrust:
          overrides?.impactPercentages?.userTrust ?? template.impactPercentages.userTrust,
        operationalOverhead:
          overrides?.impactPercentages?.operationalOverhead ??
          template.impactPercentages.operationalOverhead,
      },
    },
    recommendedActions: template.recommendedActions,
    humanDecisionOptions: template.humanDecisionOptions,
  };
}

/**
 * Impact templates for common finding categories.
 */
const IMPACT_TEMPLATES: Record<
  string,
  {
    whatThisMeans: string;
    scopeOfImpact: {
      affectedBuildComponents: string[];
      userJourneyImpact: string;
      dataIntegrityRisk: string;
    };
    implications: {
      ifIgnored: string;
      ifFixedNow: string;
      effortToFix: string;
    };
    impactPercentages: {
      buildStability: string;
      securityPosture: string;
      userTrust: string;
      operationalOverhead: string;
    };
    recommendedActions: string[];
    humanDecisionOptions: HumanDecisionOption[];
  }
> = {
  "Transaction Integrity Failure": {
    whatThisMeans:
      "If a customer's payment succeeds but the order record fails to save (network hiccup, DB timeout), the inventory is gone but they have no order. You now have angry customers and phantom stock.",
    scopeOfImpact: {
      affectedBuildComponents: ["checkout-service", "inventory-service", "payment-webhook"],
      userJourneyImpact:
        "Purchase completion → Refund requests → Support tickets",
      dataIntegrityRisk:
        "Orphaned inventory records and unreconciled payments",
    },
    implications: {
      ifIgnored:
        "Financial loss, chargebacks, inconsistent warehouse counts, manual reconciliation overhead",
      ifFixedNow:
        "Atomic inventory reservation, automatic rollback on failure, consistent state",
      effortToFix:
        "Medium: wrap inventory + order in transaction or add compensating cleanup job",
    },
    impactPercentages: {
      buildStability: "15% risk of flaky checkout under load",
      securityPosture: "8% increase in data-consistency attack surface",
      userTrust: "35% potential churn if checkout failures spike during launch",
      operationalOverhead: "40% increase in support ticket volume",
    },
    recommendedActions: [
      "Add database transaction wrapping inventory decrement + order creation",
      "Add compensating cleanup job for orphaned reservations (TTL-based)",
      "Add idempotency key to payment webhook to prevent double-charge on retry",
    ],
    humanDecisionOptions: [
      {
        type: "APPROVE_WITH_FIX",
        description: "Merge after addressing transaction boundary",
        consequence: "Fix applied; risk eliminated; normal merge flow resumes",
      },
      {
        type: "APPROVE_WITH_TICKET",
        description: "Merge now, create P1 ticket for follow-up within 24h",
        consequence: "Risk accepted temporarily; ticket must be resolved before next release",
      },
      {
        type: "REJECT",
        description: "Requires atomic fix before merge",
        consequence: "PR blocked until transaction boundary is implemented",
      },
    ],
  },
  "Authorization Gap": {
    whatThisMeans:
      "Any admin can export ANY report, not just their own. If an admin guesses or finds another report ID, they get that data. In multi-tenant setups, this means Customer A's admin sees Customer B's revenue.",
    scopeOfImpact: {
      affectedBuildComponents: ["reports-api", "export-service", "auth-middleware"],
      userJourneyImpact: "Admin dashboard → Report export → Data breach",
      dataIntegrityRisk:
        "Unauthorized data exfiltration, GDPR/privacy violations",
    },
    implications: {
      ifIgnored:
        "Regulatory fines, customer churn, reputational damage, mandatory breach disclosure",
      ifFixedNow:
        "Scoped access per tenant/user, audit trail intact, compliance maintained",
      effortToFix:
        "Low: add ownership check before export logic",
    },
    impactPercentages: {
      buildStability: "5% minimal direct crash risk",
      securityPosture: "45% critical authorization gap",
      userTrust: "60% catastrophic if exploited in production",
      operationalOverhead: "20% incident response cost if breached",
    },
    recommendedActions: [
      "Add report ownership / tenant scoping check immediately before export",
      "Add audit log entry for every export with actor + report_id",
      "Run IDOR test suite: iterate report IDs and verify 403 for non-owned resources",
    ],
    humanDecisionOptions: [
      {
        type: "APPROVE_WITH_FIX",
        description: "Add ownership check before merge",
        consequence: "Fix applied; authorization gap closed",
      },
      {
        type: "REJECT",
        description: "Authorization gap is too severe for any waiver",
        consequence: "PR blocked until authorization is enforced",
      },
    ],
  },
  "Race Condition Risk": {
    whatThisMeans:
      "Two users can claim the same limited resource at the same time and both succeed — inventory goes negative, coupon codes get double-used, or account balances become inconsistent.",
    scopeOfImpact: {
      affectedBuildComponents: ["resource-service", "inventory-db", "coupon-engine"],
      userJourneyImpact:
        "Simultaneous checkout → Both orders succeed → Negative inventory",
      dataIntegrityRisk:
        "Inventory corruption, financial reconciliation breaks",
    },
    implications: {
      ifIgnored:
        "Silent data corruption, financial audit failures, customer trust erosion",
      ifFixedNow:
        "Serializable isolation, optimistic locking, or atomic operations prevent double-allocation",
      effortToFix:
        "Medium: add SELECT FOR UPDATE or optimistic versioning to resource allocation queries",
    },
    impactPercentages: {
      buildStability: "20% risk of inventory inconsistency under concurrent load",
      securityPosture: "10% race-condition-based exploit potential",
      userTrust: "25% if users notice double-allocation or overselling",
      operationalOverhead: "30% manual reconciliation effort per incident",
    },
    recommendedActions: [
      "Add row-level locking (SELECT FOR UPDATE) to resource allocation queries",
      "Add optimistic versioning with retry logic for high-contention resources",
      "Add idempotency keys to prevent double-processing of retried requests",
    ],
    humanDecisionOptions: [
      {
        type: "APPROVE_WITH_FIX",
        description: "Add locking/versioning before merge",
        consequence: "Race condition eliminated; concurrent safety restored",
      },
      {
        type: "APPROVE_WITH_TICKET",
        description: "Merge now, create P0 ticket for fix within 48h",
        consequence: "Risk accepted with strict SLA; monitoring alert added",
      },
    ],
  },
  "Secrets Leakage": {
    whatThisMeans:
      "An API key or credential has been found in the codebase. If this reaches production, anyone who can read the repo (or the compiled code if the secret is inlined) can use that credential.",
    scopeOfImpact: {
      affectedBuildComponents: ["entire system", "third-party integrations"],
      userJourneyImpact:
        "Secret exposure → Credential abuse → Data breach or service compromise",
      dataIntegrityRisk:
        "Full account takeover if the credential has broad privileges",
    },
    implications: {
      ifIgnored:
        "Immediate security incident, mandatory rotation, potential regulatory notification",
      ifFixedNow:
        "Revoke exposed secret, rotate, store in secrets manager, audit for abuse",
      effortToFix: "Low: revoke + rotate + move to env/secret manager",
    },
    impactPercentages: {
      buildStability: "0% (no crash risk)",
      securityPosture: "90% critical exposure",
      userTrust: "80% if breach is disclosed",
      operationalOverhead: "50% incident response overhead",
    },
    recommendedActions: [
      "Immediately revoke the exposed credential",
      "Rotate and store in secrets manager (Vault, AWS Secrets Manager, etc.)",
      "Audit access logs for unauthorized use of the exposed credential",
      "Add pre-commit hook to prevent future secret commits",
    ],
    humanDecisionOptions: [
      {
        type: "REJECT",
        description: "Secret must be revoked and removed before merge",
        consequence: "PR blocked; no exceptions for secrets in code",
      },
    ],
  },
  "Generic Finding": {
    whatThisMeans:
      "An automated review finding requires human evaluation to determine actual impact and appropriate response.",
    scopeOfImpact: {
      affectedBuildComponents: ["unknown"],
      userJourneyImpact: "Depends on finding specifics",
      dataIntegrityRisk: "Depends on finding specifics",
    },
    implications: {
      ifIgnored: "Unknown risk; could range from cosmetic to critical",
      ifFixedNow: "Risk eliminated or reduced",
      effortToFix: "Variable — assess based on finding details",
    },
    impactPercentages: {
      buildStability: "Unknown — requires human assessment",
      securityPosture: "Unknown — requires human assessment",
      userTrust: "Unknown — requires human assessment",
      operationalOverhead: "Unknown — requires human assessment",
    },
    recommendedActions: [
      "Review the automated finding and assess impact",
      "Determine fix priority based on business context",
    ],
    humanDecisionOptions: [
      {
        type: "APPROVE_WITH_FIX",
        description: "Address the finding before merge",
        consequence: "Risk eliminated before deployment",
      },
      {
        type: "APPROVE_WITH_TICKET",
        description: "Accept risk, create follow-up ticket",
        consequence: "Risk tracked and scheduled for resolution",
      },
      {
        type: "REJECT",
        description: "Finding is too severe to accept",
        consequence: "PR blocked until resolved",
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// Rendering Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Render a BlindSpotDeclaration as a Markdown string suitable for PR comments.
 */
export function renderBlindSpotMarkdown(bsd: BlindSpotDeclaration): string {
  const confidenceEmoji =
    bsd.confidenceScore >= 80 ? "🟢" : bsd.confidenceScore >= 60 ? "🟡" : "🔴";

  return [
    `---`,
    ``,
    `### ⚠️ Blind Spot Declaration — ${bsd.section}`,
    ``,
    `${confidenceEmoji} **Confidence**: ${bsd.confidenceScore}% — ${bsd.systemLimitNote}`,
    ``,
    `**Things the system might miss:**`,
    ``,
    ...bsd.thingsSystemMightMiss.map((item) => `- ${item}`),
    ``,
    `**🎯 Human focus**: ${bsd.recommendedHumanFocus}`,
    ``,
    `> *This is an automated honesty statement. The system knows what it knows, and more importantly, what it doesn't.*`,
    ``,
  ].join("\n");
}

/**
 * Render a BuildImpactTranslator as a Markdown string suitable for PR escalation cards.
 */
export function renderImpactMarkdown(bit: BuildImpactTranslator): string {
  const { t } = bit.laymensTranslation;

  return [
    `---`,
    ``,
    `## 🔴 ESCALATION: ${bit.escalationId}`,
    ``,
    `**Finding**: ${bit.findingCategory}`,
    ``,
    `> ${bit.technicalSummary}`,
    ``,
    `### What this means to your build`,
    ``,
    `> ${t.whatThisMeans}`,
    ``,
    `**Scope of impact**`,
    `- **Components hit**: ${t.scopeOfImpact.affectedBuildComponents.join(", ")}`,
    `- **User journey**: ${t.scopeOfImpact.userJourneyImpact}`,
    `- **Data integrity risk**: ${t.scopeOfImpact.dataIntegrityRisk}`,
    ``,
    `**Implications**`,
    ``,
    `| If you ignore this | If you fix it now | Effort |`,
    `|---|---|---|`,
    `| ${t.implications.ifIgnored} | ${t.implications.ifFixedNow} | ${t.implications.effortToFix} |`,
    ``,
    `**Impact on your build**`,
    `- 🏗️ Build stability: **${t.impactPercentages.buildStability}**`,
    `- 🔒 Security posture: **${t.impactPercentages.securityPosture}**`,
    `- 😤 User trust: **${t.impactPercentages.userTrust}**`,
    `- 📊 Operational overhead: **${t.impactPercentages.operationalOverhead}**`,
    ``,
    `**Recommended actions**`,
    ...bit.recommendedActions.map((a, i) => `${i + 1}. ${a}`),
    ``,
    `**Your decision**`,
    ...bit.humanDecisionOptions.map((opt) => {
      const emoji =
        opt.type === "APPROVE_WITH_FIX"
          ? "✅"
          : opt.type === "APPROVE_WITH_TICKET"
            ? "⚠️"
            : "❌";
      return `- ${emoji} **${opt.type}** — ${opt.description}`;
    }),
    ``,
    `> *Consequence: each option has different implications for your build timeline and risk posture. Choose based on your release context.*`,
    ``,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Zod Schemas (for validation)
// ═══════════════════════════════════════════════════════════════

export const BlindSpotDeclarationSchema = z.object({
  id: z.string(),
  riskLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  section: z.string(),
  automatedFindingsCount: z.number().int().min(0),
  thingsSystemMightMiss: z.array(z.string()),
  confidenceScore: z.number().min(0).max(100),
  recommendedHumanFocus: z.string(),
  systemLimitNote: z.string(),
});

export const HumanDecisionOptionSchema = z.object({
  type: z.enum(["APPROVE_WITH_FIX", "APPROVE_WITH_TICKET", "REJECT"]),
  description: z.string(),
  consequence: z.string(),
});

export const BuildImpactTranslatorSchema = z.object({
  escalationId: z.string(),
  findingCategory: z.string(),
  technicalSummary: z.string(),
  laymensTranslation: z.object({
    whatThisMeans: z.string(),
    scopeOfImpact: z.object({
      affectedBuildComponents: z.array(z.string()),
      userJourneyImpact: z.string(),
      dataIntegrityRisk: z.string(),
    }),
    implications: z.object({
      ifIgnored: z.string(),
      ifFixedNow: z.string(),
      effortToFix: z.string(),
    }),
    impactPercentages: z.object({
      buildStability: z.string(),
      securityPosture: z.string(),
      userTrust: z.string(),
      operationalOverhead: z.string(),
    }),
  }),
  recommendedActions: z.array(z.string()),
  humanDecisionOptions: z.array(HumanDecisionOptionSchema),
});

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

export { BLIND_SPOT_KNOWLEDGE, IMPACT_TEMPLATES };
