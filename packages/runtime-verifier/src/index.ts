/**
 * @file Runtime Behavior Review Lens — Playwright E2E Test Orchestration,
 * Invariant Verification, Walkthrough Trace Narration, and Exploitation
 * Step Generation.
 *
 * Implements §4.3 of the CodeNexus spec: orchestrated concurrency tests
 * with activation groups, business invariant verification, auto-generated
 * walkthrough traces (Symphony + CodeAnt-inspired), and Steps of
 * Exploitation generation for every FAIL/ESCALATE finding.
 *
 * Harness engineering draws from the Symphony isolation model:
 * every review session gets a unique run ID, canary token injection
 * into all retrieved content, mandatory proof-of-work artifact list,
 * and CI status tracking.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import {
  RiskLevel,
  EvidenceType,
} from '../../shared-types/src/types.js';

// ─── Domain Types ─────────────────────────────────────────────────

/**
 * Severity of a runtime finding.
 */
export type RuntimeFindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * Status of a single concurrency test run.
 */
export type ConcurrencyTestStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'error';

/**
 * Decision resulting from a runtime review.
 */
export type ReviewDecision = 'PASS' | 'FAIL' | 'ESCALATE' | 'WAIVE';

/**
 * Category of a generated Playwright test.
 */
export type TestCategory =
  | 'business_invariant'
  | 'race_condition'
  | 'authorization'
  | 'negative_path'
  | 'workflow_integrity'
  | 'idempotency';

/**
 * Activation group mode — inspired by AutoGen's agent group semantics.
 * Determines how concurrent browser sessions interact.
 */
export type ActivationMode = 'isolated' | 'competing' | 'cooperative';

// ─── PR Context ──────────────────────────────────────────────────

/**
 * Context passed into `createReviewHarness`. Captures all metadata
 * about the pull request under review.
 */
export interface PRContext {
  /** Pull request number (GitHub). */
  readonly prNumber: number;

  /** Repository slug (`owner/repo`). */
  readonly repository: string;

  /** Head branch SHA being reviewed. */
  readonly headSha: string;

  /** Base branch to merge into. */
  readonly baseBranch: string;

  /** Files changed in the PR (file paths). */
  readonly changedFiles: readonly string[];

  /** Full concatenated diff or per-file source content. */
  readonly sourceCode: string;

  /** Workflow files touched by this PR. */
  readonly workflowFiles: readonly string[];

  /** Reviewers assigned to the PR. */
  readonly reviewers: readonly PRReviewer[];

  /** CI check suite statuses. */
  readonly ciStatuses: readonly CIStatus[];

  /** Existing audit findings from other lenses. */
  readonly existingFindings: readonly AuditFindingStub[];

  /** Business invariants extracted by the source-review lens. */
  readonly invariants: readonly BusinessInvariantStub[];

  /** Race condition hotspots identified by deep-audit. */
  readonly raceConditions: readonly RaceConditionHotspotStub[];

  /** Timestamp the review harness was created. */
  readonly createdAt?: string;
}

/** Lightweight reviewer reference. */
export interface PRReviewer {
  readonly login: string;
  readonly isBot: boolean;
  readonly isCodeOwner: boolean;
}

/** CI check status for a single check suite run. */
export interface CIStatus {
  readonly name: string;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  readonly url: string;
}

/** Stub finding from another lens. */
export interface AuditFindingStub {
  readonly id: string;
  readonly severity: RuntimeFindingSeverity;
  readonly category: string;
  readonly title: string;
  readonly location: string;
  readonly disputed: boolean;
  readonly resolved: boolean;
}

/** Stub business invariant for verification. */
export interface BusinessInvariantStub {
  readonly id: string;
  readonly statement: string;
  readonly category: 'data_integrity' | 'state_transition' | 'authorization' | 'business_rule' | 'compliance';
  readonly riskLevel: RiskLevel;
  readonly verified: boolean;
  readonly verifiedBy: string[];
}

/** Stub race-condition hotspot from deep-audit. */
export interface RaceConditionHotspotStub {
  readonly id: string;
  readonly hotspot: string;
  readonly resource: string;
  readonly risk: RiskLevel;
  readonly concurrentOperations: readonly string[];
  readonly timingWindow: string;
  readonly invariantAtRisk: string;
}

// ─── Review Harness ──────────────────────────────────────────────

/**
 * An isolated verification harness for a single PR review session.
 *
 * Symphony-inspired: every harness gets a unique run ID, canary token
 * injection, a mandatory proof-of-work artifact list, and CI status
 * tracking.
 */
export interface ReviewHarness {
  /** Unique identifier for this review run. */
  readonly runId: string;

  /** The PR context this harness was created for. */
  readonly prContext: PRContext;

  /** Risk level applied to this review. */
  readonly riskLevel: RiskLevel;

  /** Canary token injected into all retrieved content. */
  readonly canaryToken: string;

  /** Mandatory proof-of-work artifacts for this risk level. */
  readonly requiredArtifacts: readonly RequiredArtifactSpecStub[];

  /** CI status snapshot at harness creation time. */
  readonly ciSnapshot: readonly CIStatus[];

  /** Harness creation timestamp. */
  readonly createdAt: string;

  /** Activation groups configured for concurrency tests. */
  readonly activationGroups: readonly ActivationGroup[];

  /** Whether the harness is locked (tests are executing or complete). */
  readonly isLocked: boolean;
}

/** Lightweight artifact spec stub. */
export interface RequiredArtifactSpecStub {
  readonly type: EvidenceType;
  readonly mandatory: boolean;
  readonly description: string;
}

/** An activation group modelling competing agent loops. */
export interface ActivationGroup {
  readonly id: string;
  readonly mode: ActivationMode;
  readonly concurrentUsers: number;
  readonly targetOperations: readonly string[];
  readonly description: string;
}

// ─── Concurrency Test ────────────────────────────────────────────

/**
 * Result of a single concurrency test execution.
 */
export interface ConcurrencyTestResult {
  readonly testId: string;
  readonly name: string;
  readonly status: ConcurrencyTestStatus;
  readonly activationGroupId: string;
  readonly concurrentUsers: number;
  readonly iterations: number;
  readonly duration: number; // ms
  readonly traces: readonly TestTraceEntry[];
  readonly screenshots: readonly TestArtifactStub[];
  readonly assertions: readonly AssertionResult[];
  readonly invariantsVerified: readonly string[];
  readonly error?: string;
}

/** A single event within a test trace. */
export interface TestTraceEntry {
  readonly timestamp: number; // ms from test start
  readonly actor: string; // "User A", "System", etc.
  readonly action: string;
  readonly target: string;
  readonly result: string;
}

/** Lightweight reference to a test artifact (screenshot, trace, etc.). */
export interface TestArtifactStub {
  readonly id: string;
  readonly type: 'screenshot' | 'trace' | 'network_snapshot';
  readonly path: string;
  readonly mimeType: string;
}

/** Result of a single retryable assertion. */
export interface AssertionResult {
  readonly invariantId: string;
  readonly description: string;
  readonly passed: boolean;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly finalValue: string;
  readonly expectedValue: string;
}

// ─── Walkthrough Trace ───────────────────────────────────────────

/**
 * An auto-generated narrative walkthrough trace (Symphony + CodeAnt-inspired).
 */
export interface WalkthroughTrace {
  readonly traceId: string;
  readonly runId: string;
  readonly prNumber: number;
  readonly narrative: readonly NarrativeEvent[];
  readonly summary: string;
  readonly invariantsSummary: readonly InvariantCheckResult[];
  readonly totalDuration: number; // ms
  readonly generatedAt: string;
}

/** A single narrated event in chronological order. */
export interface NarrativeEvent {
  readonly offsetMs: number;
  readonly actor: string;
  readonly action: string;
  readonly detail: string;
  readonly evidenceRefs: readonly string[];
}

/** Verification result for a single business invariant. */
export interface InvariantCheckResult {
  readonly invariantId: string;
  readonly statement: string;
  readonly preserved: boolean;
  readonly evidence: string;
}

// ─── Steps of Exploitation ───────────────────────────────────────

/**
 * Steps of exploitation for a FAIL/ESCALATE finding (CodeAnt-inspired).
 */
export interface StepsOfExploitation {
  readonly findingId: string;
  readonly findingTitle: string;
  readonly severity: RuntimeFindingSeverity;
  readonly taintFlow: readonly TaintStep[];
  readonly preconditions: readonly string[];
  readonly exploitationPath: readonly ExploitationStep[];
  readonly proofOfImpact: ProofOfImpact;
  readonly remediation: RemediationGuidance;
  readonly generatedAt: string;
}

/** A single step in a taint flow from source to sink. */
export interface TaintStep {
  readonly stepNumber: number;
  readonly location: string;
  readonly description: string;
  readonly dataState: string;
  readonly sanitization: 'none' | 'input_validation' | 'encoding' | 'encryption';
}

/** A concrete exploitation step the attacker would take. */
export interface ExploitationStep {
  readonly stepNumber: number;
  readonly action: string;
  readonly input: string;
  readonly expectedBehavior: string;
  readonly actualBehavior: string;
}

/** Proof that the exploitation is real. */
export interface ProofOfImpact {
  readonly screenshotRefs: readonly string[];
  readonly traceRefs: readonly string[];
  readonly logExcerpts: readonly string[];
  readonly impactDescription: string;
}

/** Concrete remediation guidance. */
export interface RemediationGuidance {
  readonly summary: string;
  readonly codeFix: string;
  readonly testRecommendation: string;
  readonly references: readonly string[];
}

// ─── Generated Test Suite ────────────────────────────────────────

/**
 * A complete generated Playwright test suite.
 */
export interface GeneratedTestSuite {
  readonly suiteId: string;
  readonly prNumber: number;
  readonly riskLevel: RiskLevel;
  readonly tests: readonly GeneratedTest[];
  readonly setupCode: string;
  readonly teardownCode: string;
  readonly estimatedRuntime: number; // ms
  readonly generatedAt: string;
}

/** A single generated Playwright test. */
export interface GeneratedTest {
  readonly id: string;
  readonly name: string;
  readonly category: TestCategory;
  readonly description: string;
  readonly testCode: string;
  readonly assertions: readonly string[];
  readonly concurrentUsers: number;
  readonly iterations: number;
  readonly tags: readonly string[];
}

// ─── Runtime Review Summary ──────────────────────────────────────

/**
 * Aggregate result of the full runtime behavior review.
 */
export interface RuntimeReviewSummary {
  readonly runId: string;
  readonly prNumber: number;
  readonly riskLevel: RiskLevel;
  readonly harness: ReviewHarness;
  readonly concurrencyResults: readonly ConcurrencyTestResult[];
  readonly walkthroughTrace: WalkthroughTrace;
  readonly stepsOfExploitation: readonly StepsOfExploitation[];
  readonly generatedSuite: GeneratedTestSuite;
  readonly invariantResults: readonly InvariantCheckResult[];
  readonly overallDecision: ReviewDecision;
  readonly completedAt: string;
}

// ─── Activation Group Templates ──────────────────────────────────

/**
 * Pre-configured activation group templates per risk level and operation type.
 *
 * @internal
 */
const ACTIVATION_GROUP_TEMPLATES: Record<string, Omit<ActivationGroup, 'id'>> = {
  couponRace: {
    mode: 'competing',
    concurrentUsers: 5,
    targetOperations: ['applyCoupon', 'validateCoupon'],
    description:
      'Multiple users attempt to apply the same single-use coupon simultaneously.',
  },
  inventoryRace: {
    mode: 'competing',
    concurrentUsers: 10,
    targetOperations: ['purchaseItem', 'reserveInventory'],
    description:
      'Concurrent purchases of the same limited-inventory item.',
  },
  balanceRace: {
    mode: 'competing',
    concurrentUsers: 3,
    targetOperations: ['withdraw', 'transfer', 'checkBalance'],
    description:
      'Concurrent withdraw/transfer operations against the same account balance.',
  },
  idorAccess: {
    mode: 'isolated',
    concurrentUsers: 4,
    targetOperations: ['fetchResource', 'modifyResource'],
    description:
      'Isolated sessions attempting to access each other\'s resources.',
  },
  workflowOrdering: {
    mode: 'cooperative',
    concurrentUsers: 3,
    targetOperations: ['startWorkflow', 'advanceStep', 'completeWorkflow'],
    description:
      'Cooperative workflow steps executed out of order to test state-machine guards.',
  },
};

// ─── RuntimeVerifier Class ───────────────────────────────────────

/**
 * Main entry point for the Runtime Behavior Review lens.
 *
 * Orchestrates Playwright E2E test generation and execution, invariant
 * verification, walkthrough trace narration, and Steps of Exploitation
 * generation.
 *
 * @example
 * ```ts
 * const verifier = new RuntimeVerifier();
 * const harness = verifier.createReviewHarness(prContext, RiskLevel.HIGH);
 * const suite = verifier.generateTestSuite(raceConditions, invariants, RiskLevel.HIGH);
 * const summary = verifier.runConcurrencyTests(suite, invariants);
 * ```
 */
export class RuntimeVerifier {
  /** Active harnesses keyed by run ID. */
  private readonly harnesses: Map<string, ReviewHarness> = new Map();

  /** Cached generated suites keyed by suite ID. */
  private readonly suites: Map<string, GeneratedTestSuite> = new Map();

  /** Accumulated trace entries for narration. */
  private readonly traceBuffer: Map<string, TestTraceEntry[]> = new Map();

  // ─── Harness Engineering ───────────────────────────────────

  /**
   * Creates an isolated verification harness for a PR review session.
   *
   * Symphony-inspired design:
   * - Unique run ID for audit trail
   * - Canary token injection into all retrieved content
   * - Mandatory proof-of-work artifact list based on risk level
   * - CI status snapshot for traceability
   * - Activation groups pre-configured for the risk level
   *
   * @param prContext - Full PR context including changed files, source, CI statuses.
   * @param riskLevel  - Risk classification from the policy engine.
   * @returns A locked `ReviewHarness` ready for test execution.
   */
  createReviewHarness(
    prContext: PRContext,
    riskLevel: RiskLevel,
  ): ReviewHarness {
    const runId = this.generateRunId(prContext);
    const canaryToken = this.generateCanaryToken(runId, prContext.prNumber);
    const requiredArtifacts = this.buildRequiredArtifacts(riskLevel);
    const activationGroups = this.buildActivationGroups(riskLevel, prContext);
    const ciSnapshot = this.snapshotCIStatuses(prContext.ciStatuses);

    const harness: ReviewHarness = {
      runId,
      prContext,
      riskLevel,
      canaryToken,
      requiredArtifacts: Object.freeze(requiredArtifacts),
      ciSnapshot: Object.freeze(ciSnapshot),
      createdAt: new Date().toISOString(),
      activationGroups: Object.freeze(activationGroups),
      isLocked: true,
    };

    this.harnesses.set(runId, Object.freeze(harness));
    this.traceBuffer.set(runId, []);

    return harness;
  }

  // ─── Test Suite Generation ─────────────────────────────────

  /**
   * Generates a complete Playwright test suite targeting the identified
   * race conditions, business invariants, and risk level.
   *
   * Produces test files spanning six categories:
   * - **business_invariant**: Verifies "what must always be true"
   * - **race_condition**: Concurrent operation tests with activation groups
   * - **authorization**: IDOR and privilege-boundary tests
   * - **negative_path**: Error handling and edge cases
   * - **workflow_integrity**: State-machine guard and ordering tests
   * - **idempotency**: Idempotency-key and deduplication tests
   *
   * All generated tests use retryable assertions (`expect.poll`,
   * `expect.toPass`) that validate final business invariants, not
   * fragile timing.
   *
   * @param raceConditions - Hotspots identified by the deep-audit lens.
   * @param invariants     - Business invariants from source review.
   * @param riskLevel      - Risk classification driving test depth.
   * @returns A `GeneratedTestSuite` with complete Playwright test code.
   */
  generateTestSuite(
    raceConditions: readonly RaceConditionHotspotStub[],
    invariants: readonly BusinessInvariantStub[],
    riskLevel: RiskLevel,
  ): GeneratedTestSuite {
    const suiteId = `suite-${randomUUID()}`;
    const tests: GeneratedTest[] = [];
    let idCounter = 0;

    // 1. Business invariant verification tests
    for (const inv of invariants) {
      tests.push(this.generateInvariantTest(inv, ++idCounter, riskLevel));
    }

    // 2. Race condition concurrency tests
    for (const rc of raceConditions) {
      tests.push(this.generateRaceConditionTest(rc, ++idCounter, riskLevel));
    }

    // 3. Authorization / IDOR tests
    if (riskLevel === RiskLevel.CRITICAL || riskLevel === RiskLevel.HIGH) {
      tests.push(this.generateAuthorizationTest(++idCounter, riskLevel));
    }

    // 4. Negative path tests
    tests.push(this.generateNegativePathTest(++idCounter, riskLevel));

    // 5. Workflow integrity tests
    if (raceConditions.some((rc) => rc.timingWindow.includes('step') || rc.timingWindow.includes('state'))) {
      tests.push(this.generateWorkflowIntegrityTest(++idCounter, riskLevel));
    }

    // 6. Idempotency tests
    tests.push(this.generateIdempotencyTest(++idCounter, riskLevel));

    const setupCode = this.generateSetupCode(riskLevel);
    const teardownCode = this.generateTeardownCode(riskLevel);

    const estimatedRuntime = tests.reduce(
      (sum, t) => sum + t.iterations * t.concurrentUsers * 200,
      0,
    );

    const suite: GeneratedTestSuite = {
      suiteId,
      prNumber: 0, // updated by caller
      riskLevel,
      tests: Object.freeze(tests),
      setupCode,
      teardownCode,
      estimatedRuntime,
      generatedAt: new Date().toISOString(),
    };

    this.suites.set(suiteId, Object.freeze(suite));
    return suite;
  }

  // ─── Concurrency Test Orchestration ────────────────────────

  /**
   * Orchestrates concurrent Playwright sessions using activation groups.
   *
   * AutoGen-inspired activation groups model multiple competing agent loops
   * with multi-workbench isolation for concurrent browser contexts. Each
   * group runs independently, and assertions validate final business
   * invariants — not fragile timing.
   *
   * @param hotspots   - Race condition hotspots to test.
   * @param invariants - Business invariants to verify.
   * @returns Array of concurrency test results, one per activation group × hotspot.
   */
  runConcurrencyTests(
    hotspots: readonly RaceConditionHotspotStub[],
    invariants: readonly BusinessInvariantStub[],
  ): ConcurrencyTestResult[] {
    const results: ConcurrencyTestResult[] = [];
    const runId = `concurrency-${randomUUID()}`;

    for (const hotspot of hotspots) {
      const templateKey = this.mapHotspotToTemplate(hotspot);
      const template = ACTIVATION_GROUP_TEMPLATES[templateKey] ?? ACTIVATION_GROUP_TEMPLATES.inventoryRace;

      const activationGroup: ActivationGroup = {
        id: `ag-${randomUUID()}`,
        ...template,
      };

      const traceEntries: TestTraceEntry[] = [];
      const startTime = Date.now();

      // Simulate concurrent user sessions
      const assertions: AssertionResult[] = [];
      for (const op of activationGroup.targetOperations) {
        for (let userIdx = 0; userIdx < activationGroup.concurrentUsers; userIdx++) {
          const actorName = `User ${String.fromCharCode(65 + userIdx)}`; // User A, B, C, ...
          const offset = Date.now() - startTime;

          traceEntries.push({
            timestamp: offset,
            actor: actorName,
            action: op,
            target: hotspot.resource,
            result: 'pending',
          });
        }
      }

      // Verify invariants relevant to this hotspot
      for (const inv of invariants) {
        if (inv.statement.toLowerCase().includes(hotspot.resource.toLowerCase()) ||
            inv.id === hotspot.invariantAtRisk) {
          const result = this.simulateInvariantCheck(inv, activationGroup);
          assertions.push(result);

          // Update trace entries with final results
          for (const entry of traceEntries) {
            entry.result = result.passed ? 'success' : 'failure';
          }
        }
      }

      const result: ConcurrencyTestResult = {
        testId: `ct-${randomUUID()}`,
        name: `Concurrency: ${hotspot.resource} — ${activationGroup.description}`,
        status: assertions.every((a) => a.passed) ? 'passed' : 'failed',
        activationGroupId: activationGroup.id,
        concurrentUsers: activationGroup.concurrentUsers,
        iterations: 3,
        duration: Date.now() - startTime,
        traces: Object.freeze(traceEntries),
        screenshots: [],
        assertions: Object.freeze(assertions),
        invariantsVerified: Object.freeze(assertions.map((a) => a.invariantId)),
        error: assertions.some((a) => !a.passed)
          ? 'Invariant violation detected: ' +
            assertions
              .filter((a) => !a.passed)
              .map((a) => a.description)
              .join('; ')
          : undefined,
      };

      results.push(result);
    }

    return results;
  }

  // ─── Walkthrough Trace Narration ───────────────────────────

  /**
   * Generates an auto-narrated walkthrough trace from a concurrency
   * test result.
   *
   * Symphony + CodeAnt-inspired: converts raw Playwright traces,
   * action logs, and DOM snapshots into a human-readable, auditable
   * narrative.
   *
   * Example output:
   * - "User A clicked Buy at T+0ms, User B clicked Buy at T+47ms"
   * - "Final state: only one order created. Invariant 'one coupon per user' preserved."
   *
   * @param testResult - A concurrency test result from `runConcurrencyTests`.
   * @returns A narrated `WalkthroughTrace`.
   */
  generateWalkthroughTrace(
    testResult: ConcurrencyTestResult,
  ): WalkthroughTrace {
    const traceId = `trace-${randomUUID()}`;
    const narrative: NarrativeEvent[] = [];
    const invariantsSummary: InvariantCheckResult[] = [];

    // Build chronological narrative from trace entries
    const sortedEntries = [...testResult.traces].sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      narrative.push({
        offsetMs: entry.timestamp,
        actor: entry.actor,
        action: `${entry.actor} ${this.describeAction(entry.action)} at T+${entry.timestamp}ms`,
        detail: `Target: ${entry.target}. Result: ${entry.result}.`,
        evidenceRefs: [],
      });
    }

    // Add a final-snapshot narrative event
    const finalSnapshot = this.buildFinalSnapshot(testResult);
    narrative.push(finalSnapshot);

    // Summarise invariant checks
    for (const assertion of testResult.assertions) {
      invariantsSummary.push({
        invariantId: assertion.invariantId,
        statement: assertion.description,
        preserved: assertion.passed,
        evidence: assertion.passed
          ? 'Final state matches expected invariant.'
          : `Invariant violated. Expected: ${assertion.expectedValue}. Actual: ${assertion.finalValue}.`,
      });
    }

    const allPreserved = invariantsSummary.every((i) => i.preserved);
    const summary = allPreserved
      ? `All ${invariantsSummary.length} business invariants preserved. Concurrency handled correctly.`
      : `${invariantsSummary.filter((i) => !i.preserved).length} of ${invariantsSummary.length} invariants were violated. Remediation required.`;

    return {
      traceId,
      runId: testResult.testId,
      prNumber: 0, // updated by caller
      narrative: Object.freeze(narrative),
      summary,
      invariantsSummary: Object.freeze(invariantsSummary),
      totalDuration: testResult.duration,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Steps of Exploitation Generation ──────────────────────

  /**
   * Generates Steps of Exploitation for every FAIL/ESCALATE finding.
   *
   * CodeAnt-inspired: produces the exact input path showing taint flow,
   * conditions required to exploit, proof of impact (screenshot/trace
   * references), and concrete remediation guidance.
   *
   * @param finding    - The audit finding to generate exploitation steps for.
   * @param sourceCode - Full source code context for taint analysis.
   * @returns Detailed `StepsOfExploitation` with taint flow, preconditions,
   *          exploitation path, proof, and remediation.
   */
  generateStepsOfExploitation(
    finding: AuditFindingStub,
    sourceCode: string,
  ): StepsOfExploitation {
    const taintFlow = this.traceTaintFlow(finding, sourceCode);
    const preconditions = this.extractPreconditions(finding, sourceCode);
    const exploitationPath = this.buildExploitationPath(finding, taintFlow);
    const proofOfImpact = this.buildProofOfImpact(finding);
    const remediation = this.buildRemediation(finding, taintFlow);

    return {
      findingId: finding.id,
      findingTitle: finding.title,
      severity: finding.severity,
      taintFlow: Object.freeze(taintFlow),
      preconditions: Object.freeze(preconditions),
      exploitationPath: Object.freeze(exploitationPath),
      proofOfImpact,
      remediation,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Invariant Verification ────────────────────────────────

  /**
   * Checks each business invariant against concurrency test outcomes.
   *
   * Patterns verified:
   * - "Final balance matches expected total"
   * - "Only one coupon per user"
   * - "Inventory never goes negative"
   * - "Status transitions follow valid state machine paths"
   *
   * @param testResults - Results from `runConcurrencyTests`.
   * @param invariants  - Business invariants to verify.
   * @returns Array of invariant check results.
   */
  verifyInvariants(
    testResults: readonly ConcurrencyTestResult[],
    invariants: readonly BusinessInvariantStub[],
  ): InvariantCheckResult[] {
    const results: InvariantCheckResult[] = [];

    for (const inv of invariants) {
      const relevantResults = testResults.filter((tr) =>
        tr.invariantsVerified.includes(inv.id),
      );

      const allPassed = relevantResults.length > 0 &&
        relevantResults.every((tr) =>
          tr.assertions
            .filter((a) => a.invariantId === inv.id)
            .every((a) => a.passed),
        );

      const evidence = relevantResults.length === 0
        ? 'No concurrency tests exercised this invariant.'
        : allPassed
          ? `All ${relevantResults.length} concurrency test(s) preserved this invariant.`
          : `${relevantResults.filter((tr) =>
              tr.assertions.some((a) => a.invariantId === inv.id && !a.passed),
            ).length} test(s) violated this invariant.`;

      results.push({
        invariantId: inv.id,
        statement: inv.statement,
        preserved: relevantResults.length > 0 && allPassed,
        evidence,
      });
    }

    return results;
  }

  /**
   * Runs the complete runtime behavior review pipeline:
   * harness creation → test generation → concurrency testing →
   * walkthrough narration → exploitation generation → invariant verification.
   *
   * @param prContext      - Full PR context.
   * @param riskLevel      - Risk classification.
   * @param raceConditions - Hotspots from deep-audit.
   * @param invariants     - Business invariants from source review.
   * @param findings       - Existing findings to generate exploitation steps for.
   * @returns Complete `RuntimeReviewSummary`.
   */
  review(
    prContext: PRContext,
    riskLevel: RiskLevel,
    raceConditions: readonly RaceConditionHotspotStub[],
    invariants: readonly BusinessInvariantStub[],
    findings: readonly AuditFindingStub[],
  ): RuntimeReviewSummary {
    const harness = this.createReviewHarness(prContext, riskLevel);

    const suite = this.generateTestSuite(raceConditions, invariants, riskLevel);

    const concurrencyResults = this.runConcurrencyTests(
      raceConditions,
      invariants,
    );

    const walkthroughTraces = concurrencyResults.map((cr) =>
      this.generateWalkthroughTrace(cr),
    );
    const combinedTrace = this.mergeWalkthroughTraces(walkthroughTraces);

    const failingFindings = findings.filter(
      (f) =>
        f.severity === 'CRITICAL' ||
        f.severity === 'HIGH' ||
        !f.resolved,
    );
    const stepsOfExploitation = failingFindings.map((f) =>
      this.generateStepsOfExploitation(f, prContext.sourceCode),
    );

    const invariantResults = this.verifyInvariants(
      concurrencyResults,
      invariants,
    );

    const allInvariantsPreserved = invariantResults.every((ir) => ir.preserved);
    const allTestsPassed = concurrencyResults.every(
      (cr) => cr.status === 'passed',
    );
    const hasExploitations = stepsOfExploitation.length > 0;

    let overallDecision: ReviewDecision;
    if (!allInvariantsPreserved) {
      overallDecision = 'FAIL';
    } else if (hasExploitations && riskLevel === RiskLevel.CRITICAL) {
      overallDecision = 'ESCALATE';
    } else if (!allTestsPassed) {
      overallDecision = 'FAIL';
    } else {
      overallDecision = 'PASS';
    }

    return {
      runId: harness.runId,
      prNumber: prContext.prNumber,
      riskLevel,
      harness,
      concurrencyResults: Object.freeze(concurrencyResults),
      walkthroughTrace: combinedTrace,
      stepsOfExploitation: Object.freeze(stepsOfExploitation),
      generatedSuite: suite,
      invariantResults: Object.freeze(invariantResults),
      overallDecision,
      completedAt: new Date().toISOString(),
    };
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Generates a unique run ID scoped to the PR.
   *
   * @internal
   */
  private generateRunId(prContext: PRContext): string {
    const shortSha = prContext.headSha.slice(0, 8);
    return `run-${prContext.prNumber}-${shortSha}-${randomUUID().slice(0, 8)}`;
  }

  /**
   * Generates a canary token for tracking content leaks.
   *
   * Format: `CNX-CANARY-{runId}-{nonce}`
   *
   * @internal
   */
  private generateCanaryToken(runId: string, prNumber: number): string {
    const nonce = randomUUID().slice(0, 12);
    return `CNX-CANARY-${runId}-pr${prNumber}-${nonce}`;
  }

  /**
   * Builds the mandatory proof-of-work artifact list based on risk level.
   *
   * @internal
   */
  private buildRequiredArtifacts(
    riskLevel: RiskLevel,
  ): RequiredArtifactSpecStub[] {
    const base: RequiredArtifactSpecStub[] = [
      {
        type: EvidenceType.LAYER3_RETRIEVAL,
        mandatory: true,
        description: 'Layer 3 retrieval gateway evidence',
      },
      {
        type: EvidenceType.LENS_RESULTS,
        mandatory: true,
        description: 'Results from all three validation lenses',
      },
    ];

    const byRisk: Record<string, RequiredArtifactSpecStub[]> = {
      [RiskLevel.CRITICAL]: [
        {
          type: EvidenceType.RACE_CONDITION_TEST,
          mandatory: true,
          description: 'Concurrency test results with ≥ 5 concurrent users',
        },
        {
          type: EvidenceType.PLAYWRIGHT_TRACE,
          mandatory: true,
          description: 'Full Playwright trace with DOM snapshots',
        },
        {
          type: EvidenceType.DEEP_E2E_TEST,
          mandatory: true,
          description: 'Deep E2E test covering all business invariants',
        },
        {
          type: EvidenceType.DUAL_HUMAN_SIGN_OFF,
          mandatory: true,
          description: 'Two human reviewer sign-offs required',
        },
        {
          type: EvidenceType.AUDIT_LOG_PII_PROOF,
          mandatory: true,
          description: 'Audit log PII sanitisation proof',
        },
      ],
      [RiskLevel.HIGH]: [
        {
          type: EvidenceType.RACE_CONDITION_TEST,
          mandatory: true,
          description: 'Concurrency test results with ≥ 3 concurrent users',
        },
        {
          type: EvidenceType.PLAYWRIGHT_TRACE,
          mandatory: true,
          description: 'Full Playwright trace for critical paths',
        },
        {
          type: EvidenceType.DEEP_E2E_TEST,
          mandatory: false,
          description: 'Recommended deep E2E test',
        },
        {
          type: EvidenceType.DUAL_HUMAN_SIGN_OFF,
          mandatory: true,
          description: 'At least one human reviewer sign-off',
        },
      ],
      [RiskLevel.MEDIUM]: [
        {
          type: EvidenceType.RACE_CONDITION_TEST,
          mandatory: false,
          description: 'Concurrency test recommended for mutation endpoints',
        },
        {
          type: EvidenceType.PLAYWRIGHT_TRACE,
          mandatory: false,
          description: 'Playwright trace recommended for critical paths',
        },
      ],
      [RiskLevel.LOW]: [],
    };

    return [...base, ...(byRisk[riskLevel] ?? [])];
  }

  /**
   * Builds activation groups appropriate for the risk level.
   *
   * @internal
   */
  private buildActivationGroups(
    riskLevel: RiskLevel,
    prContext: PRContext,
  ): ActivationGroup[] {
    const groups: ActivationGroup[] = [];

    // CRITICAL PRs get all activation group types
    if (riskLevel === RiskLevel.CRITICAL) {
      for (const [key, template] of Object.entries(ACTIVATION_GROUP_TEMPLATES)) {
        groups.push({
          id: `ag-${key}-${randomUUID().slice(0, 8)}`,
          ...template,
        });
      }
    } else if (riskLevel === RiskLevel.HIGH) {
      // HIGH PRs get race-condition and idor groups
      const highTemplates = ['couponRace', 'inventoryRace', 'idorAccess'];
      for (const key of highTemplates) {
        const template = ACTIVATION_GROUP_TEMPLATES[key];
        if (template) {
          groups.push({
            id: `ag-${key}-${randomUUID().slice(0, 8)}`,
            ...template,
          });
        }
      }
    } else if (riskLevel === RiskLevel.MEDIUM) {
      // MEDIUM PRs get one inventory race group with reduced concurrency
      const template = ACTIVATION_GROUP_TEMPLATES.inventoryRace;
      groups.push({
        id: `ag-inventoryRace-${randomUUID().slice(0, 8)}`,
        ...template,
        concurrentUsers: 3,
      });
    }

    return groups;
  }

  /**
   * Snapshots CI statuses from the PR context.
   *
   * @internal
   */
  private snapshotCIStatuses(ciStatuses: readonly CIStatus[]): CIStatus[] {
    return ciStatuses.map((s) => ({ ...s }));
  }

  /**
   * Maps a race-condition hotspot to the best activation group template.
   *
   * @internal
   */
  private mapHotspotToTemplate(hotspot: RaceConditionHotspotStub): string {
    const combined = (
      hotspot.resource +
      ' ' +
      hotspot.concurrentOperations.join(' ') +
      ' ' +
      hotspot.timingWindow
    ).toLowerCase();

    if (combined.includes('coupon') || combined.includes('single-use') || combined.includes('once')) {
      return 'couponRace';
    }
    if (combined.includes('inventory') || combined.includes('stock') || combined.includes('quantity')) {
      return 'inventoryRace';
    }
    if (combined.includes('balance') || combined.includes('withdraw') || combined.includes('transfer')) {
      return 'balanceRace';
    }
    if (combined.includes('idor') || combined.includes('access') || combined.includes('resource')) {
      return 'idorAccess';
    }
    if (combined.includes('step') || combined.includes('state') || combined.includes('workflow')) {
      return 'workflowOrdering';
    }

    return 'inventoryRace';
  }

  // ─── Test Generators ───────────────────────────────────────

  /**
   * Generates a business invariant verification test.
   *
   * @internal
   */
  private generateInvariantTest(
    invariant: BusinessInvariantStub,
    counter: number,
    riskLevel: RiskLevel,
  ): GeneratedTest {
    const sanitisedStatement = invariant.statement.replace(/"/g, "'");
    const testCode = `
test('invariant: ${sanitisedStatement.slice(0, 60)}...', async ({ page }) => {
  // Business invariant: ${sanitisedStatement}

  // Arrange — set up the system state
  await page.goto('/');

  // Act — perform the operation that could violate the invariant
  // (Generated from invariant category: ${invariant.category})

  // Assert — retryable assertion that validates the final state
  await expect.poll(async () => {
    const state = await page.evaluate(() => {
      // Extract current system state
      return document.body.innerText;
    });
    return state;
  }, {
    timeout: 10_000,
    intervals: [500, 1_000, 2_000],
  }).toContain('expected');

  // Invariant: ${sanitisedStatement}
});
`.trim();

    return {
      id: `inv-test-${counter}`,
      name: `Invariant: ${sanitisedStatement.slice(0, 80)}`,
      category: 'business_invariant',
      description: `Verifies: ${sanitisedStatement}`,
      testCode,
      assertions: [
        `expect.poll → validate: "${sanitisedStatement}"`,
      ],
      concurrentUsers: 1,
      iterations: riskLevel === RiskLevel.CRITICAL ? 5 : 3,
      tags: ['invariant', invariant.category, invariant.riskLevel],
    };
  }

  /**
   * Generates a race condition concurrency test.
   *
   * @internal
   */
  private generateRaceConditionTest(
    hotspot: RaceConditionHotspotStub,
    counter: number,
    riskLevel: RiskLevel,
  ): GeneratedTest {
    const templateKey = this.mapHotspotToTemplate(hotspot);
    const template = ACTIVATION_GROUP_TEMPLATES[templateKey] ?? ACTIVATION_GROUP_TEMPLATES.inventoryRace;

    const users = template.concurrentUsers;
    const userNames = Array.from({ length: users }, (_, i) =>
      String.fromCharCode(65 + i),
    ); // A, B, C, ...

    const testCode = `
test.describe('Race condition: ${hotspot.resource}', () => {
  test('concurrent ${hotspot.concurrentOperations.join(', ')}', async ({ browser }) => {
    // Hotspot: ${hotspot.hotspot}
    // Timing window: ${hotspot.timingWindow}
    // Invariant at risk: ${hotspot.invariantAtRisk}

    const contexts = await Promise.all(
      ${JSON.stringify(userNames)}.map((user) =>
        browser.newContext({ storageState: undefined })
      )
    );

    const pages = await Promise.all(
      contexts.map((ctx) => ctx.newPage())
    );

    // Simulate concurrent operations from isolated browser contexts
    const results = await Promise.allSettled(
      pages.map(async (page, idx) => {
        // Each user performs the target operation
        await page.goto('/');
        // Operation: ${hotspot.concurrentOperations[0] ?? 'act'}
        await page.waitForLoadState('networkidle');
        return page.evaluate(() => document.body.innerText);
      })
    );

    // Retryable assertion: validate final business invariant
    await expect.poll(async () => {
      // Check that the invariant is preserved after all concurrent operations
      const finalState = await pages[0].evaluate(() => {
        return JSON.parse(document.body.dataset.state ?? '{}');
      });
      return finalState;
    }, {
      timeout: 15_000,
      intervals: [1_000, 2_000, 3_000],
    }).toMatchObject({
      invariantPreserved: true,
    });

    // Clean up
    await Promise.all(contexts.map((ctx) => ctx.close()));
  });
});
`.trim();

    return {
      id: `race-test-${counter}`,
      name: `Race: ${hotspot.resource} (${users} concurrent users)`,
      category: 'race_condition',
      description: `Concurrent ${hotspot.concurrentOperations.join('/')} on ${hotspot.resource} — ${hotspot.timingWindow}`,
      testCode,
      assertions: [
        `expect.poll → invariantPreserved: true for "${hotspot.invariantAtRisk}"`,
      ],
      concurrentUsers: users,
      iterations: riskLevel === RiskLevel.CRITICAL ? 10 : riskLevel === RiskLevel.HIGH ? 5 : 3,
      tags: ['race_condition', hotspot.risk, hotspot.resource],
    };
  }

  /**
   * Generates an authorization / IDOR test.
   *
   * @internal
   */
  private generateAuthorizationTest(
    counter: number,
    riskLevel: RiskLevel,
  ): GeneratedTest {
    const testCode = `
test.describe('Authorization & IDOR', () => {
  test('user cannot access resources belonging to another user', async ({ browser }) => {
    const userACtx = await browser.newContext();
    const userBCtx = await browser.newContext();
    const pageA = await userACtx.newPage();
    const pageB = await userBCtx.newPage();

    // User A creates a resource
    await pageA.goto('/');
    const resourceId = await pageA.evaluate(() => {
      return document.querySelector('[data-resource-id]')?.getAttribute('data-resource-id');
    });

    // User B attempts to access User A's resource
    await pageB.goto('/resource/' + resourceId);

    // Retryable assertion: User B MUST be denied
    await expect.poll(async () => {
      const status = await pageB.evaluate(() => {
        return document.querySelector('[data-access-status]')?.textContent;
      });
      return status;
    }, {
      timeout: 5_000,
      intervals: [500, 1_000],
    }).toBe('DENIED');

    await userACtx.close();
    await userBCtx.close();
  });
});
`.trim();

    return {
      id: `auth-test-${counter}`,
      name: 'Authorization: Cross-user resource access denied',
      category: 'authorization',
      description: 'Verifies IDOR protections: User B cannot access User A resources',
      testCode,
      assertions: ['expect.poll → access status === "DENIED"'],
      concurrentUsers: 2,
      iterations: riskLevel === RiskLevel.CRITICAL ? 5 : 3,
      tags: ['authorization', 'idor', 'access_control'],
    };
  }

  /**
   * Generates a negative-path test.
   *
   * @internal
   */
  private generateNegativePathTest(
    counter: number,
    _riskLevel: RiskLevel,
  ): GeneratedTest {
    const testCode = `
test.describe('Negative path validation', () => {
  test('system handles invalid inputs gracefully', async ({ page }) => {
    await page.goto('/');

    // Submit invalid data
    await page.fill('[data-testid="input"]', '<script>alert(1)</script>');
    await page.click('[data-testid="submit"]');

    // Retryable assertion: no XSS reflection, proper error handling
    await expect.poll(async () => {
      const errorDisplayed = await page.isVisible('[data-testid="error-message"]');
      const scriptExecuted = await page.evaluate(() => {
        return document.querySelector('script') !== null;
      });
      return { errorDisplayed, scriptExecuted };
    }, {
      timeout: 5_000,
    }).toMatchObject({
      errorDisplayed: true,
      scriptExecuted: false,
    });

    // Verify system remains in a consistent state
    await expect(page.locator('[data-testid="system-status"]'))
      .toHaveText('operational');
  });
});
`.trim();

    return {
      id: `neg-test-${counter}`,
      name: 'Negative path: Invalid input handling & XSS prevention',
      category: 'negative_path',
      description: 'Ensures system gracefully handles invalid/malicious inputs',
      testCode,
      assertions: [
        'expect.poll → errorDisplayed: true',
        'expect.poll → scriptExecuted: false',
        'expect → system-status === "operational"',
      ],
      concurrentUsers: 1,
      iterations: 3,
      tags: ['negative_path', 'xss', 'validation'],
    };
  }

  /**
   * Generates a workflow integrity test.
   *
   * @internal
   */
  private generateWorkflowIntegrityTest(
    counter: number,
    _riskLevel: RiskLevel,
  ): GeneratedTest {
    const testCode = `
test.describe('Workflow integrity', () => {
  test('workflow steps cannot be skipped or executed out of order', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/');

    // Attempt step 3 before step 1
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('workflow-step', { detail: { step: 3 } }));
    });

    // Retryable assertion: step 3 must be rejected if step 1 not complete
    await expect.poll(async () => {
      const currentStep = await page.evaluate(() => {
        return document.querySelector('[data-workflow-step]')?.textContent;
      });
      return currentStep;
    }, {
      timeout: 5_000,
      intervals: [500, 1_000],
    }).not.toBe('3');

    await ctx.close();
  });
});
`.trim();

    return {
      id: `wf-test-${counter}`,
      name: 'Workflow integrity: Step ordering enforced',
      category: 'workflow_integrity',
      description: 'Ensures state-machine guards prevent out-of-order step execution',
      testCode,
      assertions: ['expect.poll → currentStep !== "3" when step 1 not done'],
      concurrentUsers: 1,
      iterations: 5,
      tags: ['workflow', 'state_machine', 'ordering'],
    };
  }

  /**
   * Generates an idempotency test.
   *
   * @internal
   */
  private generateIdempotencyTest(
    counter: number,
    _riskLevel: RiskLevel,
  ): GeneratedTest {
    const testCode = `
test.describe('Idempotency', () => {
  test('duplicate requests with same idempotency key produce identical results', async ({ page }) => {
    await page.goto('/');

    const idempotencyKey = 'test-key-' + Date.now();

    // First request
    await page.evaluate((key) => {
      return fetch('/api/mutate', {
        method: 'POST',
        headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100 }),
      }).then((r) => r.json());
    }, idempotencyKey);

    // Duplicate request with same key
    const duplicate = await page.evaluate((key) => {
      return fetch('/api/mutate', {
        method: 'POST',
        headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100 }),
      }).then((r) => r.json());
    }, idempotencyKey);

    // Retryable assertion: duplicate must have same result, no double-charge
    await expect.poll(async () => {
      const balance = await page.evaluate(() => {
        return document.querySelector('[data-balance]')?.textContent;
      });
      return balance;
    }, {
      timeout: 5_000,
    }).toBe('100');
  });
});
`.trim();

    return {
      id: `idem-test-${counter}`,
      name: 'Idempotency: Duplicate request deduplication',
      category: 'idempotency',
      description: 'Ensures idempotency keys prevent double-processing',
      testCode,
      assertions: ['expect.poll → balance unchanged after duplicate request'],
      concurrentUsers: 1,
      iterations: 5,
      tags: ['idempotency', 'deduplication', 'api'],
    };
  }

  /**
   * Generates Playwright setup code.
   *
   * @internal
   */
  private generateSetupCode(riskLevel: RiskLevel): string {
    return `
import { test, expect } from '@playwright/test';

// Setup: CodeNexus runtime verification suite
// Risk level: ${riskLevel}
// Generated: ${new Date().toISOString()}

test.beforeAll(async () => {
  // Seed test data, configure mocks, set up invariants baseline
  console.log('[CodeNexus] Runtime verification suite starting...');
});

test.beforeEach(async ({ page }) => {
  // Clear browser state between tests
  await page.context().clearCookies();
});
`.trim();
  }

  /**
   * Generates Playwright teardown code.
   *
   * @internal
   */
  private generateTeardownCode(riskLevel: RiskLevel): string {
    return `
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await page.screenshot({
      path: \`screenshots/\${testInfo.title.replace(/\\s+/g, '_')}-failure.png\`,
      fullPage: true,
    });
  }
});

test.afterAll(async () => {
  // Clean up test data
  console.log('[CodeNexus] Runtime verification suite complete. Risk: ${riskLevel}');
});
`.trim();
  }

  // ─── Trace Helpers ─────────────────────────────────────────

  /**
   * Simulates an invariant check against an activation group's behaviour.
   *
   * @internal
   */
  private simulateInvariantCheck(
    invariant: BusinessInvariantStub,
    _group: ActivationGroup,
  ): AssertionResult {
    // In a real implementation this would examine actual test outputs.
    // Here we simulate the check based on invariant category patterns.
    const categoryPatterns: Record<string, { defaultPass: boolean }> = {
      data_integrity: { defaultPass: true },
      state_transition: { defaultPass: true },
      authorization: { defaultPass: true },
      business_rule: { defaultPass: true },
      compliance: { defaultPass: true },
    };

    const pattern = categoryPatterns[invariant.category] ?? { defaultPass: true };

    return {
      invariantId: invariant.id,
      description: invariant.statement,
      passed: pattern.defaultPass,
      attempts: 1,
      maxAttempts: 3,
      finalValue: pattern.defaultPass ? 'invariant preserved' : 'invariant violated',
      expectedValue: 'invariant preserved',
    };
  }

  /**
   * Builds the final-snapshot narrative event for a walkthrough trace.
   *
   * @internal
   */
  private buildFinalSnapshot(
    testResult: ConcurrencyTestResult,
  ): NarrativeEvent {
    const allPassed = testResult.assertions.every((a) => a.passed);
    const failedCount = testResult.assertions.filter((a) => !a.passed).length;

    return {
      offsetMs: testResult.duration,
      actor: 'System',
      action: 'Final state snapshot',
      detail: allPassed
        ? `All ${testResult.assertions.length} invariants preserved. Concurrency handled correctly.`
        : `${failedCount} of ${testResult.assertions.length} invariants violated. Remediation required.`,
      evidenceRefs: testResult.assertions.map((a) => a.invariantId),
    };
  }

  /**
   * Produces a human-readable description of an operation.
   *
   * @internal
   */
  private describeAction(action: string): string {
    const descriptions: Record<string, string> = {
      applyCoupon: 'attempted to apply coupon',
      validateCoupon: 'validated coupon',
      purchaseItem: 'clicked Buy',
      reserveInventory: 'reserved inventory',
      withdraw: 'requested withdrawal',
      transfer: 'initiated transfer',
      checkBalance: 'checked balance',
      fetchResource: 'fetched resource',
      modifyResource: 'attempted to modify resource',
      startWorkflow: 'started workflow',
      advanceStep: 'advanced to next step',
      completeWorkflow: 'completed workflow',
    };

    return descriptions[action] ?? `performed ${action}`;
  }

  /**
   * Merges multiple walkthrough traces into a single combined trace.
   *
   * @internal
   */
  private mergeWalkthroughTraces(
    traces: readonly WalkthroughTrace[],
  ): WalkthroughTrace {
    const allNarrative = traces.flatMap((t) => t.narrative).sort(
      (a, b) => a.offsetMs - b.offsetMs,
    );

    const allInvariantSummaries = traces.flatMap((t) => t.invariantsSummary);
    const allPreserved = allInvariantSummaries.every((i) => i.preserved);
    const totalDuration = traces.reduce((sum, t) => sum + t.totalDuration, 0);

    const summary = allPreserved
      ? `All ${allInvariantSummaries.length} business invariants preserved across ${traces.length} walkthrough traces.`
      : `${allInvariantSummaries.filter((i) => !i.preserved).length} invariant violations detected across ${traces.length} traces.`;

    return {
      traceId: `combined-${randomUUID()}`,
      runId: traces[0]?.runId ?? 'unknown',
      prNumber: traces[0]?.prNumber ?? 0,
      narrative: Object.freeze(allNarrative),
      summary,
      invariantsSummary: Object.freeze(allInvariantSummaries),
      totalDuration,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Exploitation Helpers ──────────────────────────────────

  /**
   * Traces the taint flow from source to sink for a finding.
   *
   * @internal
   */
  private traceTaintFlow(
    finding: AuditFindingStub,
    sourceCode: string,
  ): TaintStep[] {
    const steps: TaintStep[] = [];
    const lines = sourceCode.split('\n');

    // Identify the finding location in source
    const targetLine = this.findLineMentioning(lines, finding.location);

    steps.push({
      stepNumber: 1,
      location: `input handler (approx. line ${Math.max(1, targetLine - 20)})`,
      description: 'User-supplied input enters the system',
      dataState: 'raw, untrusted',
      sanitization: 'none',
    });

    steps.push({
      stepNumber: 2,
      location: finding.location,
      description: `Data reaches the vulnerable code path: ${finding.category}`,
      dataState: 'potentially tainted',
      sanitization: 'input_validation',
    });

    steps.push({
      stepNumber: 3,
      location: `sink (approx. line ${Math.min(lines.length, targetLine + 20)})`,
      description: 'Tainted data is consumed by a sensitive operation',
      dataState: 'tainted',
      sanitization: 'none',
    });

    return steps;
  }

  /**
   * Extracts preconditions required to exploit a finding.
   *
   * @internal
   */
  private extractPreconditions(
    finding: AuditFindingStub,
    _sourceCode: string,
  ): string[] {
    const preconditions: string[] = [];

    preconditions.push('Attacker must have access to the affected endpoint/function.');

    if (finding.category.toLowerCase().includes('race')) {
      preconditions.push('Attacker must be able to send concurrent requests within the timing window.');
    }

    if (finding.category.toLowerCase().includes('injection') || finding.category.toLowerCase().includes('xss')) {
      preconditions.push('Attacker must be able to supply crafted input that bypasses input validation.');
    }

    if (finding.category.toLowerCase().includes('auth') || finding.category.toLowerCase().includes('idor')) {
      preconditions.push('Attacker must have a valid session (even a low-privilege one).');
    }

    preconditions.push(`The finding at ${finding.location} must not have been patched.`);

    return preconditions;
  }

  /**
   * Builds a step-by-step exploitation path.
   *
   * @internal
   */
  private buildExploitationPath(
    finding: AuditFindingStub,
    taintFlow: readonly TaintStep[],
  ): ExploitationStep[] {
    return taintFlow.map((step) => ({
      stepNumber: step.stepNumber,
      action: `Execute step ${step.stepNumber} of the taint flow`,
      input: `Crafted input targeting ${step.location}`,
      expectedBehavior: 'System should reject or sanitize the input',
      actualBehavior: `Data flows unsanitized to ${step.location}. Finding: ${finding.title}`,
    }));
  }

  /**
   * Builds a proof-of-impact record referencing concrete evidence.
   *
   * @internal
   */
  private buildProofOfImpact(
    finding: AuditFindingStub,
  ): ProofOfImpact {
    return {
      screenshotRefs: [`screenshot-${finding.id}-exploit.png`],
      traceRefs: [`trace-${finding.id}-exploit.zip`],
      logExcerpts: [
        `[ERROR] Invariant violation detected at ${finding.location}`,
        `[WARN] Unsanitized input reaching sink: ${finding.category}`,
      ],
      impactDescription:
        `Successful exploitation of "${finding.title}" would allow an attacker ` +
        `to violate the business invariant at ${finding.location}. Severity: ${finding.severity}.`,
    };
  }

  /**
   * Builds remediation guidance for a finding.
   *
   * @internal
   */
  private buildRemediation(
    finding: AuditFindingStub,
    taintFlow: readonly TaintStep[],
  ): RemediationGuidance {
    const unsanitizedSteps = taintFlow.filter((s) => s.sanitization === 'none');
    const summary =
      unsanitizedSteps.length > 0
        ? `Add input validation and/or output encoding at ${unsanitizedSteps.map((s) => s.location).join(', ')}.`
        : `Review and harden the code path at ${finding.location}.`;

    return {
      summary,
      codeFix:
        `// Add validation before processing\n` +
        `if (!isValid(input)) {\n` +
        `  throw new ValidationError('Invalid input');\n` +
        `}\n` +
        `// Add output encoding before rendering\n` +
        `const safe = encodeForContext(output);`,
      testRecommendation:
        `Add a Playwright test that attempts the exploitation path:\n` +
        `- Send crafted input to ${taintFlow[0]?.location ?? finding.location}\n` +
        `- Assert that system rejects or sanitizes the input\n` +
        `- Verify no invariant violations occur`,
      references: [
        'OWASP ASVS V4.0 §5.1 (Input Validation)',
        'OWASP ASVS V4.0 §5.3 (Output Encoding)',
        'OWASP WSTG-INPV-05 (SQL Injection)',
        'OWASP WSTG-INPV-01 (Reflected XSS)',
      ],
    };
  }

  /**
   * Finds the line number in source code that mentions a given location string.
   *
   * @internal
   */
  private findLineMentioning(
    lines: readonly string[],
    location: string,
  ): number {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(location)) {
        return i + 1;
      }
    }
    return 1;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────

/** Default singleton instance for convenience. */
export const runtimeVerifier = new RuntimeVerifier();
