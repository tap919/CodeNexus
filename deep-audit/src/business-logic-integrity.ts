/**
 * @file §4.1 Business Logic and Workflow Integrity
 *
 * Analyzes source code for:
 * - Workflow circumvention (process timing, function reuse limits, step-skip guards)
 * - Handoff tampering (internal↔external system boundaries)
 * - Business invariant extraction ("What must always be true")
 *
 * Conforms to OWASP ASVS 4.0 (especially V1 Architecture, V4 Access Control)
 * and OpenSSF Scorecard best practices for CI/CD integrity.
 *
 * @packageDocumentation
 */

import {
  BusinessInvariant,
  RiskLevel,
  AuditFindingSeverity,
  ValidationLens,
} from '../../shared/src/types';

// ─── Public Interfaces ───────────────────────────────────────────

/**
 * Severity-tagged workflow integrity finding produced by the analysis
 * functions in this module.
 */
export interface WorkflowIntegrityFinding {
  /** Unique identifier for this finding. */
  readonly id: string;

  /** Severity based on OWASP ASVS classification. */
  readonly severity: AuditFindingSeverity;

  /** Category of the integrity issue. */
  readonly category: WorkflowIntegrityCategory;

  /** Human-readable title. */
  readonly title: string;

  /** Detailed description of the finding. */
  readonly description: string;

  /** Source-code location (file path or approximate region). */
  readonly location: string;

  /** Concrete remediation recommendation. */
  readonly recommendation: string;
}

/**
 * Categorisation of workflow integrity findings.
 *
 * - `circumvention`:  Process timing, step-skipping, function reuse limits
 * - `handoff_tampering`: Data corruption or tampering at system boundaries
 * - `invariant_violation`: Business invariants that could be breached
 */
export type WorkflowIntegrityCategory =
  | 'circumvention'
  | 'handoff_tampering'
  | 'invariant_violation';

/**
 * Result of a full workflow-integrity analysis.
 */
export interface WorkflowIntegrityResult {
  /** All findings discovered. */
  readonly findings: readonly WorkflowIntegrityFinding[];

  /** Extracted business invariants. */
  readonly invariants: readonly BusinessInvariant[];

  /** Overall risk level — highest severity among findings. */
  readonly overallRisk: RiskLevel;
}

// ─── Internal Pattern Registries ─────────────────────────────────

/**
 * Pattern describing a potential workflow-circumvention risk.
 *
 * @internal
 */
interface CircumventionPattern {
  readonly label: string;
  readonly severity: AuditFindingSeverity;
  readonly regex: RegExp;
  readonly category: WorkflowIntegrityCategory;
  readonly recommendation: string;
}

/**
 * Patterns that detect process-timing issues, missed step-completion
 * checks, missing idempotency keys, and "use-once" semantics.
 *
 * @internal
 */
const CIRCUMVENTION_PATTERNS: readonly CircumventionPattern[] = Object.freeze([
  {
    label: 'Missing idempotency key on mutation endpoint',
    severity: AuditFindingSeverity.High,
    regex: /\b(idempotency|idempotent|Idempotency)\b/i,
    category: 'circumvention',
    recommendation:
      'Add an idempotency-key header (e.g. `Idempotency-Key`) and server-side '
      + 'deduplication cache. See OWASP ASVS V4.0 §4.1.3.',
  },
  {
    label: 'Step-completion guard missing',
    severity: AuditFindingSeverity.High,
    regex:
      /\b(state\s*(machine|guard|transition)|workflow\s*step|step\s*(complete|done|fail))\b/i,
    category: 'circumvention',
    recommendation:
      "Verify each workflow step checks its predecessor's completion status "
      + 'before executing. Implement state-machine guards.',
  },
  {
    label: '"Use-once" semantics without replay protection',
    severity: AuditFindingSeverity.Critical,
    regex: /\b(used\s*once|coupon|nonce|one[-\s]?time\s*code|consumed)\b/i,
    category: 'circumvention',
    recommendation:
      'Use a server-side deduplication store (Redis, DB unique constraint) '
      + 'to enforce one-time usage. MUST validate before processing.',
  },
  {
    label: 'Sequential operation without ordering guard',
    severity: AuditFindingSeverity.Medium,
    regex:
      /\b(sequence|order|sequential|pipeline)\s*(num|number|id|check)?\b/i,
    category: 'circumvention',
    recommendation:
      'Add a sequence-number or ordering check to prevent out-of-order '
      + 'execution that could skip validation steps.',
  },
]);

/**
 * Patterns that detect handoff-tampering risks at system boundaries.
 *
 * @internal
 */
interface HandoffPattern {
  readonly label: string;
  readonly severity: AuditFindingSeverity;
  readonly regex: RegExp;
  readonly recommendation: string;
}

/**
 * Patterns for internal↔external system handoff points.
 *
 * @internal
 */
const HANDOFF_PATTERNS: readonly HandoffPattern[] = Object.freeze([
  {
    label: 'Unsigned webhook payload',
    severity: AuditFindingSeverity.Critical,
    regex: /\bwebhook\b.*\b(payload|body|data)\b/i,
    recommendation:
      'Verify webhook payloads using HMAC signatures (e.g. `X-Hub-Signature-256`). '
      + 'Reject unsigned or invalid signatures.',
  },
  {
    label: 'Message queue without integrity check',
    severity: AuditFindingSeverity.High,
    regex:
      /\b(publish|subscribe|enqueue|dequeue|produce|consume|rabbitmq|kafka|sqs|pubsub)\b/i,
    recommendation:
      'Add message-level signing or checksum to detect tampering in transit. '
      + 'Consider end-to-end encryption for sensitive payloads.',
  },
  {
    label: 'External API call without response validation',
    severity: AuditFindingSeverity.Medium,
    regex: /\bfetch\b|\baxios\b|\bgot\b|\brequest\b|\bhttp\.(get|post)\b/i,
    recommendation:
      'Validate that external API responses conform to expected schemas. '
      + 'Do not forward raw external responses to internal sinks without sanitisation.',
  },
  {
    label: 'Trust boundary crossing — logically invalid data',
    severity: AuditFindingSeverity.High,
    regex:
      /\b(redirect|forward|proxy|relay|pass\s*through|bypass)\b.*\b(url|uri|path)\b/i,
    recommendation:
      'Validate and sanitise any data crossing trust boundaries. '
      + 'Reject values that contain logical inconsistencies (e.g. internal IPs '
      + 'in external-facing fields).',
  },
]);

/**
 * Patterns used to extract business invariants from source code.
 *
 * @internal
 */
interface InvariantTemplate {
  readonly pattern: RegExp;
  readonly category: BusinessInvariant['category'];
  readonly riskLevel: RiskLevel;
  readonly statementTemplate: string;
}

/**
 * Defines "What must always be true" invariant patterns.
 *
 * @internal
 */
const INVARIANT_PATTERNS: readonly InvariantTemplate[] = Object.freeze([
  {
    pattern: /\b(balance|amount)\s*(must|shall|should|can(not)?)\s*(be|equal|exceed|not\s+exceed)/i,
    category: 'data_integrity',
    riskLevel: RiskLevel.High,
    statementTemplate:
      'The {resource} MUST always satisfy the condition: "{condition}".',
  },
  {
    pattern: /\b(status|state)\s*(must|shall|should|can(not)?)\s*(be|transition|change)/i,
    category: 'state_transition',
    riskLevel: RiskLevel.High,
    statementTemplate:
      'The {resource} state MUST only transition according to: "{condition}".',
  },
  {
    pattern: /\b(user|owner|admin|role)\s*(must|shall|should|can(not)?)\s*(have|access|modify|delete|view)/i,
    category: 'authorization',
    riskLevel: RiskLevel.Critical,
    statementTemplate:
      'A {principal} MUST {action} only if they satisfy: "{condition}".',
  },
  {
    pattern: /\b(never|always|must not|shall not|should not)\s*(exceed|be\s*negative|be\s*null|be\s*empty|be\s*duplicate)/i,
    category: 'business_rule',
    riskLevel: RiskLevel.Medium,
    statementTemplate:
      'The invariant "{condition}" MUST always be enforced for {resource}.',
  },
  {
    pattern: /\b(unique|constraint|uniqueness|dedup|duplicate)\b/i,
    category: 'data_integrity',
    riskLevel: RiskLevel.Medium,
    statementTemplate:
      'The attribute {resource} MUST remain unique across all records.',
  },
  {
    pattern: /\b(sla|deadline|timeout|expir|ttl)\b/i,
    category: 'compliance',
    riskLevel: RiskLevel.Medium,
    statementTemplate:
      'The operation {resource} MUST complete within the allowed time window.',
  },
]);

// ─── Public API ──────────────────────────────────────────────────

/**
 * Analyzes source code for workflow-circumvention risks.
 *
 * Scans for:
 * - Missing idempotency keys on mutation endpoints
 * - Absent step-completion guards in stateful workflows
 * - "Use-once" semantics lacking replay protection
 * - Sequential operations without ordering guards
 *
 * @param sourceCode - Full source code of changed files (concatenated or per-file).
 * @returns An array of `WorkflowIntegrityFinding` objects, each with severity,
 *          category, and a concrete recommendation.
 *
 * @example
 * ```ts
 * const findings = analyzeWorkflowIntegrity(code);
 * findings.filter(f => f.severity === 'CRITICAL');
 * // → findings requiring immediate action
 * ```
 */
export function analyzeWorkflowIntegrity(
  sourceCode: string,
): WorkflowIntegrityFinding[] {
  const findings: WorkflowIntegrityFinding[] = [];
  const idCounter = { value: 0 };

  for (const pattern of CIRCUMVENTION_PATTERNS) {
    const matches = sourceCode.matchAll(pattern.regex);
    for (const match of matches) {
      const lineNumber = approximateLine(sourceCode, match.index!);
      findings.push({
        id: `WF-CIRC-${++idCounter.value}`,
        severity: pattern.severity,
        category: pattern.category,
        title: pattern.label,
        description:
          `Potential workflow circumvention risk detected at approximately line `
          + `${lineNumber}. Pattern: "${match[0].trim()}".`,
        location: `line ${lineNumber}`,
        recommendation: pattern.recommendation,
      });
    }
  }

  return findings;
}

/**
 * Inspects handoff points between internal and external systems for
 * tampering risks.
 *
 * Examines:
 * - Webhook payloads for missing signature verification
 * - Message queue interactions lacking integrity checks
 * - External API calls without response validation
 * - Trust-boundary crossings with potentially invalid data
 *
 * @param sourceCode - Full source code to inspect.
 * @returns An array of findings describing potential handoff-tampering
 *          vulnerabilities.
 *
 * @example
 * ```ts
 * const handoffs = inspectHandoffPoints(code);
 * handoffs.filter(h => h.severity === 'CRITICAL');
 * // → unsigned webhook payloads, etc.
 * ```
 */
export function inspectHandoffPoints(
  sourceCode: string,
): WorkflowIntegrityFinding[] {
  const findings: WorkflowIntegrityFinding[] = [];
  const idCounter = { value: 0 };

  for (const pattern of HANDOFF_PATTERNS) {
    const matches = sourceCode.matchAll(pattern.regex);
    for (const match of matches) {
      const lineNumber = approximateLine(sourceCode, match.index!);
      findings.push({
        id: `WF-HOFF-${++idCounter.value}`,
        severity: pattern.severity,
        category: 'handoff_tampering',
        title: pattern.label,
        description:
          `Potential handoff-tampering vulnerability at approximately line `
          + `${lineNumber}. Context: "${surroundingContext(sourceCode, match.index!, 60)}".`,
        location: `line ${lineNumber}`,
        recommendation: pattern.recommendation,
      });
    }
  }

  return findings;
}

/**
 * Extracts business invariants — "What must always be true" — from
 * source code by matching declarative constraint patterns.
 *
 * @param sourceCode - Full source code to analyse.
 * @returns An array of `BusinessInvariant` objects suitable for
 *          inclusion in a `DeepAuditReport`.
 *
 * @example
 * ```ts
 * const invariants = extractBusinessInvariants(code);
 * invariants.filter(i => i.riskLevel === RiskLevel.Critical);
 * // → critical invariants that MUST be tested
 * ```
 */
export function extractBusinessInvariants(
  sourceCode: string,
): BusinessInvariant[] {
  const invariants: BusinessInvariant[] = [];
  const seen = new Set<string>();
  const idCounter = { value: 0 };

  for (const template of INVARIANT_PATTERNS) {
    const matches = sourceCode.matchAll(template.pattern);
    for (const match of matches) {
      const rawStatement = match[0].trim();
      if (seen.has(rawStatement)) {
        continue;
      }
      seen.add(rawStatement);

      const resource = match[1] ?? 'system';
      const condition = match[0];

      const statement = template.statementTemplate
        .replace(/\{resource\}/g, resource)
        .replace(/\{condition\}/g, condition)
        .replace(/\{principal\}/g, resource)
        .replace(/\{action\}/g, condition);

      invariants.push({
        id: `INV-${++idCounter.value}`,
        statement,
        category: template.category,
        riskLevel: template.riskLevel,
        verifiedBy: [ValidationLens.SourceReview],
        verified: false,
      });
    }
  }

  // If no invariants were extracted, create a meta-invariant noting the gap.
  if (invariants.length === 0) {
    invariants.push({
      id: 'INV-0',
      statement:
        'The system SHOULD document explicit business invariants. '
        + 'No invariants were automatically extractable from source code.',
      category: 'business_rule',
      riskLevel: RiskLevel.Low,
      verifiedBy: [ValidationLens.SourceReview],
      verified: false,
    });
  }

  return invariants;
}

/**
 * Runs the full workflow-integrity analysis pipeline:
 * circumvention detection → handoff inspection → invariant extraction.
 *
 * @param sourceCode - Full source code to analyse.
 * @returns A `WorkflowIntegrityResult` with all findings, invariants,
 *          and the overall risk level.
 */
export function analyzeFullWorkflowIntegrity(
  sourceCode: string,
): WorkflowIntegrityResult {
  const circumventionFindings = analyzeWorkflowIntegrity(sourceCode);
  const handoffFindings = inspectHandoffPoints(sourceCode);
  const invariants = extractBusinessInvariants(sourceCode);

  const findings: WorkflowIntegrityFinding[] = [
    ...circumventionFindings,
    ...handoffFindings,
  ];

  const overallRisk = computeOverallRisk(findings);

  return {
    findings: Object.freeze(findings),
    invariants: Object.freeze(invariants),
    overallRisk,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────

/**
 * Computes the overall risk level as the highest severity among findings.
 *
 * @internal
 */
function computeOverallRisk(findings: readonly WorkflowIntegrityFinding[]): RiskLevel {
  const severityRank: Record<AuditFindingSeverity, number> = {
    [AuditFindingSeverity.Critical]: 4,
    [AuditFindingSeverity.High]: 3,
    [AuditFindingSeverity.Medium]: 2,
    [AuditFindingSeverity.Low]: 1,
    [AuditFindingSeverity.Info]: 0,
  };

  const riskMap: Record<number, RiskLevel> = {
    4: RiskLevel.Critical,
    3: RiskLevel.High,
    2: RiskLevel.Medium,
    1: RiskLevel.Low,
    0: RiskLevel.Low,
  };

  let maxRank = 0;
  for (const f of findings) {
    const rank = severityRank[f.severity] ?? 0;
    if (rank > maxRank) {
      maxRank = rank;
    }
  }

  return riskMap[maxRank] ?? RiskLevel.Low;
}

/**
 * Estimates the 1-based line number from a character index within
 * the source code string.
 *
 * @internal
 */
function approximateLine(sourceCode: string, charIndex: number): number {
  if (charIndex < 0 || charIndex >= sourceCode.length) {
    return 0;
  }
  let line = 1;
  for (let i = 0; i < charIndex; i++) {
    if (sourceCode[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * Extracts a short snippet of surrounding source code for context.
 *
 * @internal
 */
function surroundingContext(
  sourceCode: string,
  charIndex: number,
  radius: number,
): string {
  const start = Math.max(0, charIndex - radius);
  const end = Math.min(sourceCode.length, charIndex + radius);
  return sourceCode.slice(start, end).replace(/\n/g, '\\n').trim();
}
