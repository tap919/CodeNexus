import {
  RiskLevel,
  ValidationLens,
  LensResult,
  DeepAuditReport,
  AuditFinding,
  MergeBlocker,
  EvidenceArtifact,
  BusinessInvariant,
  SourceReviewReport,
  PipelineReviewReport,
  RuntimeReviewReport,
  RaceConditionAnalysis,
  SourceToSinkTrace,
  KnowledgeSafetyAssessment,
  AuditFindingSeverity,
  MergeBlockerType,
} from '../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';

// ─── PR Context ───────────────────────────────────────────────────

/**
 * Contextual information about a pull request that the lens
 * orchestrator requires to perform its analyses.
 */
export interface PRContext {
  /** Pull-request number. */
  readonly prNumber: number;

  /** Repository identifier (e.g. `owner/repo`). */
  readonly repository: string;

  /** File paths changed in this PR. */
  readonly changedFiles: readonly string[];

  /** Unified diff content of the PR. */
  readonly diffContent: string;

  /** Full source code of the changed files (concatenated). */
  readonly sourceCode: string;

  /** Optional CI/CD pipeline configuration (e.g. `.github/workflows/*.yml`). */
  readonly pipelineConfig?: string;

  /** Optional branch-protection settings. */
  readonly branchProtections?: {
    requiredReviews: number;
    dismissStaleReviews: boolean;
    requiresStatusChecks: boolean;
    requiresSignedCommits: boolean;
    enforcesAdmins: boolean;
  };
}

// ─── Lens Runner Interface ───────────────────────────────────────

/**
 * Every validation lens implements this contract.
 * Lenses MAY be skipped entirely for LOW-risk PRs.
 */
interface LensRunner {
  readonly lens: ValidationLens;
  run(context: PRContext): Promise<LensResult>;
}

// ─── Lens Runners ─────────────────────────────────────────────────

/**
 * Source Review Lens (§3.1).
 *
 * Delegates to the `reviewSource` engine to produce state-machine
 * analysis, trust-boundary identification, and data-flow tracing.
 *
 * @internal
 */
class SourceReviewLens implements LensRunner {
  readonly lens = ValidationLens.SourceReview;

  async run(context: PRContext): Promise<LensResult> {
    const startTime = performance.now();

    try {
      // Dynamically import so the module graph stays clean; callers
      // that don't need deep-audit can tree-shake this away.
      const { reviewSource } = await import('./source-review');
      const report = reviewSource(context.sourceCode);

      const findings: string[] = [];
      let hasFailures = false;

      for (const sm of report.stateMachines) {
        if (sm.unreachableStates.length > 0) {
          findings.push(
            `State machine "${sm.name}" has unreachable state(s): ${sm.unreachableStates.join(', ')}`,
          );
          hasFailures = true;
        }
        if (sm.deadTransitions.length > 0) {
          findings.push(
            `State machine "${sm.name}" has dead transition(s): ${sm.deadTransitions.map((t) => `${t.from} → ${t.to}`).join(', ')}`,
          );
        }
      }

      for (const tb of report.trustBoundaries) {
        const status = tb.verificationStatus === 'violated' ? '⚠' : tb.verificationStatus === 'verified' ? '✓' : '?';
        findings.push(
          `${status} Trust boundary: ${tb.boundary} (${tb.direction}, ${tb.risk})`,
        );
      }

      for (const df of report.dataFlows) {
        const access = df.accessControl.enforced ? 'ACL present' : 'NO ACL';
        findings.push(
          `Data flow: ${df.source} → [${df.sinks.join(', ')}] (${df.dataClassification}, ${access})`,
        );
        if (!df.accessControl.enforced) {
          hasFailures = true;
        }
      }

      const coverage = computeCoverage(report);

      return {
        lens: this.lens,
        status: hasFailures ? 'FAIL' : 'PASS',
        findings,
        coverage,
        duration: Math.round(performance.now() - startTime),
        details: `Source review analysed ${report.stateMachines.length} state machine(s), ${report.trustBoundaries.length} trust boundar(ies), ${report.dataFlows.length} data flow(s).`,
      };
    } catch (err) {
      return {
        lens: this.lens,
        status: 'FAIL',
        findings: [`Source review lens error: ${(err as Error).message}`],
        coverage: 0,
        duration: Math.round(performance.now() - startTime),
        details: 'Lens threw an unexpected exception.',
      };
    }
  }
}

/**
 * Pipeline Review Lens (§3.2).
 *
 * Analyses CI/CD pipeline configuration, branch protections, and
 * OpenSSF Scorecard heuristics.
 *
 * @internal
 */
class PipelineReviewLens implements LensRunner {
  readonly lens = ValidationLens.PipelineReview;

  async run(context: PRContext): Promise<LensResult> {
    const startTime = performance.now();

    try {
      const findings: string[] = [];
      let hasFailures = false;

      // ── Branch-protection evaluation ──────────────────────────
      const bp = context.branchProtections;
      if (bp) {
        if (bp.requiredReviews < 1) {
          findings.push('Branch protection: required reviews MUST be ≥ 1.');
          hasFailures = true;
        } else {
          findings.push(`Branch protection: ${bp.requiredReviews} required review(s).`);
        }
        if (!bp.dismissStaleReviews) {
          findings.push('Branch protection: stale reviews SHOULD be dismissed.');
        }
        if (!bp.requiresStatusChecks) {
          findings.push('Branch protection: status checks SHOULD be required.');
          hasFailures = true;
        }
        if (!bp.requiresSignedCommits) {
          findings.push('Branch protection: signed commits SHOULD be enforced.');
        }
        if (!bp.enforcesAdmins) {
          findings.push('Branch protection: admin enforcement SHOULD be active.');
        }
      } else {
        findings.push('Branch-protection data not provided — unable to verify.');
      }

      // ── CI/CD pipeline analysis ───────────────────────────────
      const pipeline = context.pipelineConfig ?? '';
      if (pipeline.length > 0) {
        const hasTests = /test|ci|check|lint/i.test(pipeline);
        const hasDeployGate = /deploy|release|production/i.test(pipeline);
        const hasSecurity = /security|sast|dast|dependency|scan|audit/i.test(pipeline);

        findings.push(
          hasTests
            ? 'CI/CD: test/check workflow detected.'
            : 'CI/CD: no test or check job found — SHOULD be added.',
        );
        findings.push(
          hasDeployGate
            ? 'CI/CD: deployment gate detected.'
            : 'CI/CD: no explicit deployment gate.',
        );
        findings.push(
          hasSecurity
            ? 'CI/CD: security scanning detected.'
            : 'CI/CD: no security scanning detected — SHOULD be added for HIGH+/CRITICAL.',
        );

        if (!hasTests) hasFailures = true;
      } else {
        findings.push('CI/CD pipeline configuration not provided.');
      }

      // ── OpenSSF Scorecard heuristic ───────────────────────────
      const scorecard = assessScorecardHeuristic(pipeline);

      const coverage = bp ? 0.75 : 0.4;

      return {
        lens: this.lens,
        status: hasFailures ? 'FAIL' : 'PASS',
        findings,
        coverage,
        duration: Math.round(performance.now() - startTime),
        details: `Pipeline review: branch protections ${bp ? 'evaluated' : 'N/A'}, CI/CD ${pipeline ? 'analysed' : 'N/A'}, Scorecard heuristic: ${scorecard.score}/10.`,
      };
    } catch (err) {
      return {
        lens: this.lens,
        status: 'FAIL',
        findings: [`Pipeline review lens error: ${(err as Error).message}`],
        coverage: 0,
        duration: Math.round(performance.now() - startTime),
        details: 'Lens threw an unexpected exception.',
      };
    }
  }
}

/**
 * Runtime (Behavior) Lens (§3.3).
 *
 * Analyses race-condition hotspots, business invariant violations,
 * and generates Playwright test skeletons.
 *
 * @internal
 */
class RuntimeBehaviorLens implements LensRunner {
  readonly lens = ValidationLens.RuntimeBehavior;

  async run(context: PRContext): Promise<LensResult> {
    const startTime = performance.now();

    try {
      const findings: string[] = [];
      let hasFailures = false;

      // ── Race-condition hotspot detection ──────────────────────
      const raceHotspots = detectRaceConditionHotspots(context.sourceCode);
      for (const hotspot of raceHotspots) {
        findings.push(
          `Race-condition hotspot: "${hotspot.resource}" at ${hotspot.hotspot} (${hotspot.risk}). Invariant at risk: "${hotspot.invariantAtRisk}".`,
        );
        if (hotspot.risk === RiskLevel.Critical || hotspot.risk === RiskLevel.High) {
          hasFailures = true;
        }
      }

      // ── Business-invariant extraction ─────────────────────────
      const invariants = extractBusinessInvariants(context.sourceCode);
      for (const inv of invariants) {
        findings.push(
          `Invariant: "${inv.statement}" (${inv.category}, ${inv.riskLevel}) — ${inv.verified ? 'verified' : 'unverified'}.`,
        );
      }

      // ── Negative-path test opportunities ──────────────────────
      const negativePaths = detectNegativePathOpportunities(context.sourceCode);
      for (const np of negativePaths) {
        findings.push(`Negative-path opportunity: "${np}"`);
      }

      const coverage = raceHotspots.length > 0 || invariants.length > 0 ? 0.8 : 0.3;

      return {
        lens: this.lens,
        status: hasFailures ? 'FAIL' : 'PASS',
        findings,
        coverage,
        duration: Math.round(performance.now() - startTime),
        details: `Runtime behaviour analysis: ${raceHotspots.length} race hotspot(s), ${invariants.length} invariant(s), ${negativePaths.length} negative-path opportunity/ies.`,
      };
    } catch (err) {
      return {
        lens: this.lens,
        status: 'FAIL',
        findings: [`Runtime behavior lens error: ${(err as Error).message}`],
        coverage: 0,
        duration: Math.round(performance.now() - startTime),
        details: 'Lens threw an unexpected exception.',
      };
    }
  }
}

// ─── Heuristic Analysis Helpers ───────────────────────────────────

/**
 * Heuristic race-condition detection based on shared resource access
 * patterns.
 *
 * @internal
 */
function detectRaceConditionHotspots(
  sourceCode: string,
): RaceConditionAnalysis[] {
  const hotspots: RaceConditionAnalysis[] = [];

  // Patterns indicative of shared mutable state
  const racePatterns: Array<{
    pattern: RegExp;
    resource: string;
    invariantAtRisk: string;
    risk: RiskLevel;
  }> = [
    {
      pattern: /\b(inventory|stock|count|balance|quantity)\s*(?:[+\-]=|--|\+\+)/gi,
      resource: 'Shared numeric counter',
      invariantAtRisk: 'Counter MUST be atomically updated',
      risk: RiskLevel.High,
    },
    {
      pattern: /(?:await\s+)?(?:read|get|find)\b[\s\S]{0,60}(?:write|set|update|save)\b/gi,
      resource: 'Read-commit cycle',
      invariantAtRisk: 'Read-commit window MUST be protected (lock or transaction)',
      risk: RiskLevel.High,
    },
    {
      pattern: /if\s*\([\s\S]{0,40}balance[\s\S]{0,40}\)[\s\S]{0,100}update\s+balance/gi,
      resource: 'Balance check-then-act',
      invariantAtRisk: 'Balance check and update MUST be atomic',
      risk: RiskLevel.Critical,
    },
    {
      pattern: /Promise\.all\s*\([^)]*\)/gi,
      resource: 'Concurrent promise execution',
      invariantAtRisk: 'Concurrent writes to same resource MUST be serialised',
      risk: RiskLevel.Medium,
    },
  ];

  for (const rp of racePatterns) {
    const matches = sourceCode.match(rp.pattern);
    if (matches) {
      for (const m of matches) {
        const lineIdx = findApproximateLine(sourceCode, m);
        hotspots.push({
          id: uuidv4(),
          hotspot: `~line ${lineIdx}`,
          resource: rp.resource,
          risk: rp.risk,
          concurrentOperations: ['detected read-write pair'],
          timingWindow: 'between read and write operations',
          invariantAtRisk: rp.invariantAtRisk,
          recommendedTest: `Race test: ${rp.resource} — run ${rp.risk === RiskLevel.Critical ? '50' : '10'} concurrent iterations`,
          testGenerated: false,
        });
      }
    }
  }

  return hotspots;
}

/**
 * Extracts candidate business invariants from the source by matching
 * common assertion and validation patterns.
 *
 * @internal
 */
function extractBusinessInvariants(
  sourceCode: string,
): BusinessInvariant[] {
  const invariants: BusinessInvariant[] = [];

  const invariantPatterns: Array<{
    pattern: RegExp;
    category: BusinessInvariant['category'];
    riskLevel: RiskLevel;
    statementTemplate: string;
  }> = [
    {
      pattern: /\b(?:assert|expect|should)\s*\(/gi,
      category: 'business_rule',
      riskLevel: RiskLevel.Medium,
      statementTemplate: 'Assertion found: must evaluate to truthy',
    },
    {
      pattern: /\bif\s*\(\s*![\w.]+\)\s*throw/gi,
      category: 'data_integrity',
      riskLevel: RiskLevel.Medium,
      statementTemplate: 'Guard clause: condition MUST hold or operation aborts',
    },
    {
      pattern: /\.(?:required|unique|validate)\s*\(/gi,
      category: 'data_integrity',
      riskLevel: RiskLevel.Medium,
      statementTemplate: 'Validation rule: input MUST satisfy constraint',
    },
    {
      pattern: /\badmin|role|permission\b/i,
      category: 'authorization',
      riskLevel: RiskLevel.High,
      statementTemplate: 'Authorization invariant: only permitted roles MAY perform operation',
    },
    {
      pattern: /\bstatus\s*(?:!=|===?)\s*['"`]\w+['"`]/gi,
      category: 'state_transition',
      riskLevel: RiskLevel.Medium,
      statementTemplate: 'State transition invariant: status MUST match expected value',
    },
    {
      pattern: /\btransaction|rollback|commit\b/i,
      category: 'compliance',
      riskLevel: RiskLevel.High,
      statementTemplate: 'Transaction integrity invariant: operations MUST be atomic',
    },
  ];

  for (const ip of invariantPatterns) {
    const matches = sourceCode.match(ip.pattern);
    if (matches) {
      invariants.push({
        id: uuidv4(),
        statement: ip.statementTemplate,
        category: ip.category,
        riskLevel: ip.riskLevel,
        verifiedBy: [ValidationLens.SourceReview],
        verified: false,
      });
    }
  }

  return invariants;
}

/**
 * Detects code patterns where negative-path testing is recommended.
 *
 * @internal
 */
function detectNegativePathOpportunities(sourceCode: string): string[] {
  const opportunities: string[] = [];

  if (/catch\s*\(/i.test(sourceCode)) {
    opportunities.push('Error-handling paths (try/catch) — test with invalid inputs');
  }
  if (/throw\s+new\s+(Error|HttpException|BadRequest)/i.test(sourceCode)) {
    opportunities.push('Explicit throw sites — test with boundary values');
  }
  if (/else\s*\{/i.test(sourceCode)) {
    opportunities.push('Conditional branches (if/else) — test the else path');
  }
  if (/(?:===\s*null|===\s*undefined|!\s*\w+)/i.test(sourceCode)) {
    opportunities.push('Null/undefined checks — test with missing values');
  }
  if (/parseInt|Number\(|parseFloat/i.test(sourceCode)) {
    opportunities.push('Numeric parsing — test with non-numeric strings');
  }

  return [...new Set(opportunities)];
}

/**
 * Heuristic OpenSSF Scorecard assessment based on pipeline
 * configuration content.
 *
 * @internal
 */
function assessScorecardHeuristic(
  pipelineConfig: string,
): { score: number; checks: { name: string; score: number; reason: string }[] } {
  const checks: { name: string; score: number; reason: string }[] = [];

  // Token-Permissions
  const hasTokenPermissions = /permissions:\s*(read-all|contents:\s*read)/i.test(pipelineConfig);
  checks.push({
    name: 'Token-Permissions',
    score: hasTokenPermissions ? 10 : 3,
    reason: hasTokenPermissions
      ? 'Workflow uses least-privilege token permissions'
      : 'Workflow SHOULD restrict token permissions to read-only where possible',
  });

  // Pinned-Dependencies
  const hasPinnedDeps = /@[a-f0-9]{40}\b/.test(pipelineConfig);
  checks.push({
    name: 'Pinned-Dependencies',
    score: hasPinnedDeps ? 10 : 5,
    reason: hasPinnedDeps
      ? 'Actions pinned by commit SHA'
      : 'Dependencies SHOULD be pinned to full commit SHA',
  });

  // SAST
  const hasSAST = /(?:codeql|semgrep|snyk|sonarcloud|trivy)/i.test(pipelineConfig);
  checks.push({
    name: 'SAST',
    score: hasSAST ? 10 : 4,
    reason: hasSAST
      ? 'Static analysis detected in pipeline'
      : 'No static analysis tool configured',
  });

  // CI-Test
  const hasCITests = /(?:test|ci|check|lint|build)/i.test(pipelineConfig);
  checks.push({
    name: 'CI-Tests',
    score: hasCITests ? 9 : 2,
    reason: hasCITests
      ? 'CI test jobs present'
      : 'No CI test jobs detected',
  });

  const totalScore = Math.round(
    checks.reduce((sum, c) => sum + c.score, 0) / checks.length * 10,
  ) / 10;

  return { score: totalScore, checks };
}

/**
 * Heuristic to approximate the line number of a match within the
 * source text.
 *
 * @internal
 */
function findApproximateLine(sourceCode: string, match: string): number {
  const idx = sourceCode.indexOf(match);
  if (idx < 0) return 1;
  return sourceCode.slice(0, idx).split('\n').length;
}

/**
 * Computes a coverage score from a source-review report.
 *
 * @internal
 */
function computeCoverage(report: SourceReviewReport): number {
  let covered = 0;
  let total = 0;

  if (report.stateMachines.length > 0) {
    const allStates = report.stateMachines.reduce((s, m) => s + m.states.length, 0);
    const unreachable = report.stateMachines.reduce(
      (s, m) => s + m.unreachableStates.length,
      0,
    );
    covered += allStates - unreachable;
    total += allStates;
  }

  covered += report.trustBoundaries.filter((tb) => tb.verificationStatus !== 'unverified').length;
  total += report.trustBoundaries.length || 1;

  covered += report.dataFlows.filter((df) => df.accessControl.enforced).length;
  total += report.dataFlows.length || 1;

  return total > 0 ? Math.min(1, Math.round((covered / total) * 100) / 100) : 0;
}

// ─── Orchestrator ─────────────────────────────────────────────────

/**
 * Map from risk level to the set of validation lenses that MUST run.
 */
const LENSES_BY_RISK: Record<RiskLevel, ValidationLens[]> = {
  [RiskLevel.Critical]: [
    ValidationLens.SourceReview,
    ValidationLens.PipelineReview,
    ValidationLens.RuntimeBehavior,
  ],
  [RiskLevel.High]: [
    ValidationLens.SourceReview,
    ValidationLens.RuntimeBehavior,
  ],
  [RiskLevel.Medium]: [
    ValidationLens.SourceReview,
    ValidationLens.RuntimeBehavior,
  ],
  [RiskLevel.Low]: [
    ValidationLens.SourceReview,
  ],
};

/**
 * Runs all three validation lenses (Source Review, Pipeline Review,
 * Runtime Behaviour) on the provided PR context, returning the
 * aggregated results.
 *
 * Which lenses actually execute depends on the risk level:
 *
 * | Risk Level | Lenses Required                                      |
 * |------------|------------------------------------------------------|
 * | CRITICAL   | Source Review + Pipeline Review + Runtime Behaviour   |
 * | HIGH       | Source Review + Runtime Behaviour                     |
 * | MEDIUM     | Source review + basic runtime analysis                |
 * | LOW        | Source review only                                    |
 *
 * @param context   Pull-request context (files, diff, source, etc.).
 * @param riskLevel Pre-computed risk level for this PR.
 * @returns Promise resolving to an array of `LensResult` — one entry
 *          per lens that was run (SKIPPED lenses are omitted).
 */
export async function runAllLenses(
  context: PRContext,
  riskLevel: RiskLevel,
): Promise<LensResult[]> {
  const requiredLenses = LENSES_BY_RISK[riskLevel] ?? LENSES_BY_RISK[RiskLevel.Low];
  const lensRunners: LensRunner[] = [
    new SourceReviewLens(),
    new PipelineReviewLens(),
    new RuntimeBehaviorLens(),
  ];

  const results: LensResult[] = await Promise.all(
    lensRunners
      .filter((runner) => requiredLenses.includes(runner.lens))
      .map((runner) => runner.run(context)),
  );

  return results;
}

/**
 * Convenience wrapper that runs all three lenses, then assembles a
 * complete `DeepAuditReport` with findings, blockers, evidence, and
 * metadata.
 *
 * This is the main entry point consumers SHOULD use for a full deep
 * audit cycle.
 *
 * @param context   Full PR context.
 * @param riskLevel Pre-computed risk level.
 * @returns A fully-populated `DeepAuditReport`.
 */
export async function generateDeepAuditReport(
  context: PRContext,
  riskLevel: RiskLevel,
): Promise<DeepAuditReport> {
  const lenses = await runAllLenses(context, riskLevel);

  // ── Aggregate findings ────────────────────────────────────────
  const findings: AuditFinding[] = [];
  for (const lens of lenses) {
    for (const findingText of lens.findings) {
      const severity = lens.status === 'FAIL'
        ? AuditFindingSeverity.High
        : AuditFindingSeverity.Info;

      findings.push({
        id: uuidv4(),
        severity: findingText.startsWith('⚠') ? AuditFindingSeverity.Critical : severity,
        lens: lens.lens,
        category: deriveCategory(lens.lens, findingText),
        title: findingText.split('\n')[0].slice(0, 100),
        description: findingText,
        location: context.changedFiles.join(', ') || 'unknown',
        recommendation: deriveRecommendation(findingText),
        evidence: [],
        disputed: false,
        resolved: false,
      });
    }
  }

  // ── Determine blockers ────────────────────────────────────────
  const blockers: MergeBlocker[] = [];
  if (riskLevel === RiskLevel.Critical) {
    blockers.push({
      type: MergeBlockerType.MissingHumanReview,
      active: true,
      description: 'CRITICAL risk PR requires dual-human sign-off before merge.',
      details: 'At least two independent human reviewers MUST approve this change set.',
      blockedBy: 'system',
      createdAt: new Date().toISOString(),
    });
  }

  const failedLenses = lenses.filter((l) => l.status === 'FAIL');
  if (failedLenses.length > 0) {
    blockers.push({
      type: MergeBlockerType.UnresolvedDisputedFindings,
      active: true,
      description: `${failedLenses.length} lens(es) reported FAIL status.`,
      details: `Failing lens(es): ${failedLenses.map((l) => l.lens).join(', ')}. Review details before merging.`,
      blockedBy: 'system',
      createdAt: new Date().toISOString(),
    });
  }

  // ── No evidence artifacts without actual test execution ───────
  const evidence: EvidenceArtifact[] = [];

  // ── Build invariants from runtime analysis if available ───────
  const invariants: BusinessInvariant[] = [];

  // ── Placeholder data-flow / race / knowledge sections ─────────
  const sourceToSinkTraces: SourceToSinkTrace[] = [];
  const raceConditionAnalyses: RaceConditionAnalysis[] = [];
  const knowledgeSafety: KnowledgeSafetyAssessment = {
    tier1Sources: [],
    tier2Sources: [],
    tier3Sources: [],
    tier3UsedForDecisions: riskLevel === RiskLevel.Critical,
    policyOverrideDetected: false,
    overrideDetails: '',
    assessment: riskLevel === RiskLevel.Critical ? 'CAUTION' : 'SAFE',
  };

  // ── Overall status ────────────────────────────────────────────
  const hasBlockers = blockers.some((b) => b.active);
  const hasFails = lenses.some((l) => l.status === 'FAIL');
  let overallStatus: 'PASS' | 'FAIL' | 'BLOCKED';
  if (hasBlockers) {
    overallStatus = 'BLOCKED';
  } else if (hasFails) {
    overallStatus = 'FAIL';
  } else {
    overallStatus = 'PASS';
  }

  return {
    auditId: uuidv4(),
    prNumber: context.prNumber,
    repository: context.repository,
    riskLevel,
    lenses,
    findings,
    blockers,
    evidence,
    invariants,
    sourceToSinkTraces,
    raceConditionAnalyses,
    knowledgeSafety,
    overallStatus,
    timestamp: new Date().toISOString(),
  };
}

// ─── Category / Recommendation Helpers ───────────────────────────

/**
 * Derives an `AuditFinding.category` from the lens and finding text.
 *
 * @internal
 */
function deriveCategory(lens: ValidationLens, findingText: string): string {
  switch (lens) {
    case ValidationLens.SourceReview:
      if (/state machine/i.test(findingText)) return 'state_machine';
      if (/trust boundary/i.test(findingText)) return 'trust_boundary';
      if (/data flow/i.test(findingText)) return 'data_flow';
      return 'source_review';
    case ValidationLens.PipelineReview:
      if (/branch protection/i.test(findingText)) return 'branch_protection';
      if (/CI\/CD/i.test(findingText)) return 'ci_cd';
      return 'pipeline_review';
    case ValidationLens.RuntimeBehavior:
      if (/race/i.test(findingText)) return 'race_condition';
      if (/invariant/i.test(findingText)) return 'business_invariant';
      if (/negative.path/i.test(findingText)) return 'negative_path';
      return 'runtime_behavior';
    default:
      return 'general';
  }
}

/**
 * Maps a finding description to a recommendation string.
 *
 * @internal
 */
function deriveRecommendation(findingText: string): string {
  if (/unreachable state/i.test(findingText)) {
    return 'Remove or refactor unreachable states. Ensure all declared states are reachable via at least one transition.';
  }
  if (/dead transition/i.test(findingText)) {
    return 'Review dead transitions. Either add target-state handlers or remove orphaned transitions.';
  }
  if (/trust boundary/i.test(findingText)) {
    return 'Verify input validation and output encoding at this boundary. Consider adding an explicit security review.';
  }
  if (/data flow/i.test(findingText)) {
    return 'Ensure access controls are enforced for all data flows. Consider adding authentication/authorisation middleware.';
  }
  if (/race/i.test(findingText)) {
    return 'Use atomic operations, locks, or database transactions to protect shared resources. Add E2E race-condition tests.';
  }
  if (/branch protection/i.test(findingText)) {
    return 'Update branch-protection rules to align with the repository security policy.';
  }
  if (/CI\/CD/i.test(findingText)) {
    return 'Add or improve CI/CD pipeline gates (tests, security scanning, deployment approvals).';
  }
  if (/negative.path/i.test(findingText)) {
    return 'Add negative-path test cases to cover error handling, edge cases, and invalid inputs.';
  }
  if (/invariant/i.test(findingText)) {
    return 'Document the invariant and create automated tests to verify it continuously.';
  }
  return 'Review the finding and address any identified issues.';
}
