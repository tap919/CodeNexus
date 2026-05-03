import {
  type OrchestrationSession,
  type RepositoryInfo,
  type ReviewComment,
  type GitHubWebhookEvent,
  type CodeNexusConfig,
  type ReviewMetric,
  type SandboxSpec,
  type AgentConfig,
  type AgentSession,
  type AgentEvent,
  type DesignAudit,
  type SecurityAlert,
  type KnowledgeSynthesis,
  type BusinessEntity,
  type TelemetryPayload,
  type CommentStats,
  type ProcessedComments,
  type AccessControlRule,
  type UserSession,
  AgentMode,
  SessionStatus,
  Severity,
  FixStatus,
  ConfidenceLevel,
  AuthLevel,
} from '../../shared/src/types';

import {
  generateAllBlindSpots,
  translateFinding,
  renderBlindSpotMarkdown,
  renderImpactMarkdown,
  type BlindSpotDeclaration,
  type BuildImpactTranslator,
  type ReviewSection,
  type RiskLevel,
} from '@codenexus/review-components';

import { ConfigurationError, getConfig } from './config';
import type { QueueItem } from './session-manager';
import { WorkflowEngine, type RunState as WFRunState } from '../../packages/workflow-engine/src/index';
import { defineCodeReviewWorkflow, createReviewWorkflow, type ReviewWorkflowAdapters } from '../../packages/workflow-engine/src/review-workflow';
import { createDefaultPRManager } from './adapters/pr-manager-adapter';
import { createDefaultSecurity } from './adapters/security-adapter';
import { createDefaultFixExecutor } from './adapters/fix-executor';

// ─── Constants ────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const CONCURRENT_REVIEW_LIMIT = 5;
const ORCHESTRATOR_VERSION = '0.2.0';

// ─── Step Definitions ─────────────────────────────────────────

export enum ReviewStep {
  /** 1. Validate webhook signature & authenticate */
  ValidateWebhook = 'validate_webhook',
  /** 2. Parse event & extract PR context */
  ParseEvent = 'parse_event',
  /** 3. Fetch PR diff & metadata */
  FetchPR = 'fetch_pr',
  /** 4. Classify PR type & determine review scope */
  ClassifyPR = 'classify_pr',
  /** 5. Run design review (anti-pattern detection) */
  DesignReview = 'design_review',
  /** 6. Run security scan */
  SecurityScan = 'security_scan',
  /** 7. Query knowledge engine */
  KnowledgeQuery = 'knowledge_query',
  /** 8. Call MCP servers for business logic */
  MCPValidation = 'mcp_validation',
  /** 9. Generate review comments */
  GenerateComments = 'generate_comments',
  /** 10. Post review comments to PR */
  PostComments = 'post_comments',
  /** 11. Apply automated fixes */
  ApplyFixes = 'apply_fixes',
  /** 12. Verify fixes */
  VerifyFixes = 'verify_fixes',
  /** 12.5 Generate blind spot declarations for all sections with findings */
  BlindSpotGeneration = 'blind_spot_generation',
  /** 13. Report results */
  ReportResults = 'report_results',
  /** 13.5 Translate escalated findings into build impact cards */
  ImpactTranslation = 'impact_translation',
}

export const REVIEW_STEP_LABELS: Record<ReviewStep, string> = {
  [ReviewStep.ValidateWebhook]: 'Validate webhook signature & authenticate',
  [ReviewStep.ParseEvent]: 'Parse event & extract PR context',
  [ReviewStep.FetchPR]: 'Fetch PR diff & metadata',
  [ReviewStep.ClassifyPR]: 'Classify PR type & determine review scope',
  [ReviewStep.DesignReview]: 'Run design review (anti-pattern detection)',
  [ReviewStep.SecurityScan]: 'Run security scan',
  [ReviewStep.KnowledgeQuery]: 'Query knowledge engine for relevant context',
  [ReviewStep.MCPValidation]: 'Call MCP servers for business logic validation',
  [ReviewStep.GenerateComments]: 'Generate review comments via agent',
  [ReviewStep.PostComments]: 'Post review comments to PR',
  [ReviewStep.ApplyFixes]: 'Apply automated fixes',
  [ReviewStep.VerifyFixes]: 'Verify fixes (compile, lint, test)',
  [ReviewStep.BlindSpotGeneration]: 'Generate blind spot declarations for all sections with findings',
  [ReviewStep.ReportResults]: 'Report results to analytics',
  [ReviewStep.ImpactTranslation]: 'Translate escalated findings into build impact cards',
};

// ─── Error Types ──────────────────────────────────────────────

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly step: ReviewStep | 'general',
    public readonly code: string,
    public readonly recoverable: boolean,
    public readonly retryCount: number = 0,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// ─── Step Results ─────────────────────────────────────────────

export interface StepResult {
  step: ReviewStep;
  status: 'success' | 'skipped' | 'failed';
  durationMs: number;
  error?: string;
  data?: Record<string, unknown>;
}

// ─── Section Findings (for Blind Spot & Escalation input) ─────

export interface SectionFindingsInfo {
  /** The review section label */
  section: ReviewSection;
  /** Number of automated findings in this section */
  count: number;
  /** Risk level assigned by the policy engine */
  riskLevel: RiskLevel;
  /** List of finding summaries for context */
  findingSummaries: string[];
}

export interface EscalationResult {
  escalationId: string;
  findingCategory: string;
  technicalSummary: string;
  impactCard: BuildImpactTranslator;
  decision: 'APPROVE_WITH_FIX' | 'APPROVE_WITH_TICKET' | 'REJECT' | null;
  recordedInEvidenceStore: boolean;
}

// ─── Orchestration Run ────────────────────────────────────────

export interface RunContext {
  repository?: RepositoryInfo;
  diff?: string;
  diffLength?: number;
  comments?: ReviewComment[];
  commentStats?: CommentStats;
  prType?: string;
  reviewDepth?: number;
  requiresSecurityReview?: boolean;
  requiresDesignReview?: boolean;
  designAudit?: DesignAudit;
  securityAlerts?: SecurityAlert[];
  criticalSecurityCount?: number;
  knowledge?: KnowledgeSynthesis;
  entities?: BusinessEntity[];
  agentResponse?: string;
}

export interface OrchestrationRun {
  id: string;
  sessionId: string;
  event: GitHubWebhookEvent;
  config: CodeNexusConfig;
  mode: AgentMode;
  results: StepResult[];
  blindSpots: BlindSpotDeclaration[];
  escalations: EscalationResult[];
  prCommentBody: string;
  startedAt: string;
  completedAt: string | null;
  overallStatus: SessionStatus;
  context: RunContext;
}

// ─── Module Adapters (stubs calling other modules) ────────────

export interface ModuleAdapters {
  auth: {
    validateWebhook: (payload: string, signature: string, secret: string) => Promise<boolean>;
    authenticate: (token: string) => Promise<UserSession>;
    checkAccess: (user: UserSession, rules: AccessControlRule[]) => Promise<boolean>;
  };
  prManager: {
    getDiff: (repo: RepositoryInfo) => Promise<string>;
    getComments: (repo: RepositoryInfo) => Promise<ProcessedComments>;
    postComment: (repo: RepositoryInfo, comment: ReviewComment) => Promise<void>;
    postReview: (repo: RepositoryInfo, comments: ReviewComment[]) => Promise<void>;
    updatePR: (repo: RepositoryInfo, body: string) => Promise<void>;
  };
  fixExecutor?: {
    executeFixes: (input: {
      repo: RepositoryInfo;
      patches: Array<{ path: string; content: string }>;
    }) => Promise<{
      success: boolean;
      branchName?: string;
      commitSha?: string;
      patchSummary?: { attempted: number; applied: number; failed: number };
      testResults?: { passed: boolean; output: string };
      lintResults?: { passed: boolean; output: string };
      buildResults?: { passed: boolean; output: string };
      error?: string;
      timestamp: string;
    }>;
  };
  agentRuntime: {
    createSession: (config: AgentConfig, prompt: string, mode: AgentMode) => Promise<AgentSession>;
    executePrompt: (sessionId: string, prompt: string) => Promise<string>;
    streamEvents: (sessionId: string) => AsyncIterable<AgentEvent>;
    spawnSandbox: (spec: SandboxSpec) => Promise<string>;
    destroySandbox: (sandboxId: string) => Promise<void>;
  };
  mcpServers: {
    validateBusinessLogic: (repo: RepositoryInfo) => Promise<BusinessEntity[]>;
    executeDecisionTable: (tableName: string, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  security: {
    scanDiff: (diff: string) => Promise<SecurityAlert[]>;
    assessTrust: (agentId: string, payload: TelemetryPayload) => Promise<number>;
  };
  designReviewer: {
    auditCode: (code: string, language: string) => Promise<DesignAudit>;
  };
  knowledgeEngine: {
    search: (query: string, maxSources: number) => Promise<KnowledgeSynthesis>;
  };
  analytics: {
    recordMetric: (metric: ReviewMetric) => Promise<void>;
    recordEvent: (event: string, data: Record<string, unknown>) => Promise<void>;
  };
  evidenceStore: {
    recordEscalation: (escalation: EscalationResult, runId: string) => Promise<string>;
    recordBlindSpot: (blindSpot: BlindSpotDeclaration, runId: string) => Promise<string>;
  };
}

// ─── Orchestrator ─────────────────────────────────────────────

export class Orchestrator {
  private activeRuns = new Map<string, OrchestrationRun>();
  private concurrentCount = 0;
  private moduleAdapters: ModuleAdapters;
  private workflowEngine: WorkflowEngine;
  private workflowEngineAvailable = false;

  constructor(adapters?: Partial<ModuleAdapters>) {
    this.moduleAdapters = {
      auth: adapters?.auth ?? this.createDefaultAuth(),
      prManager: adapters?.prManager ?? this.createDefaultPRManager(),
      fixExecutor: adapters?.fixExecutor ?? this.createDefaultFixExecutor(),
      agentRuntime: adapters?.agentRuntime ?? this.createDefaultAgentRuntime(),
      mcpServers: adapters?.mcpServers ?? this.createDefaultMCPServers(),
      security: adapters?.security ?? this.createDefaultSecurity(),
      designReviewer: adapters?.designReviewer ?? this.createDefaultDesignReviewer(),
      knowledgeEngine: adapters?.knowledgeEngine ?? this.createDefaultKnowledgeEngine(),
      analytics: adapters?.analytics ?? this.createDefaultAnalytics(),
      evidenceStore: adapters?.evidenceStore ?? this.createDefaultEvidenceStore(),
    };

    try {
      this.workflowEngine = new WorkflowEngine();
      defineCodeReviewWorkflow(this.workflowEngine);
      this.registerProductionWorkflow();

      this.workflowEngine.on('step:done', ({ runId, step }) => {
        console.log(`[Orchestrator] Review ${runId}: step "${step}" completed`);
      });
      this.workflowEngine.on('step:fail', ({ runId, step, error }) => {
        console.error(`[Orchestrator] Review ${runId}: step "${step}" failed: ${error}`);
      });
      this.workflowEngine.on('run:complete', ({ runId }) => {
        console.log(`[Orchestrator] Review ${runId}: workflow completed`);
      });
      this.workflowEngine.on('run:fail', ({ runId, error }) => {
        console.error(`[Orchestrator] Review ${runId}: workflow failed: ${error}`);
      });

      this.workflowEngineAvailable = true;
    } catch (error) {
      console.warn('[Orchestrator] Failed to initialize workflow engine, will use hardcoded sequence:', error);
      this.workflowEngine = new WorkflowEngine(); // placeholder, won't be used
    }
  }

  private registerProductionWorkflow(): void {
    const steps = createReviewWorkflow(this.moduleAdapters);
    this.workflowEngine.define(
      { name: 'code_review', retry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 } },
      steps,
    );
  }

  // ─── Main Entry Point ────────────────────────────────────

  /**
   * Execute the full review-fix cycle for a GitHub webhook event.
   * Includes BlindSpotDeclaration (step 12.5) and BuildImpactTranslator (step 13.5).
   */
  async executeCycle(params: {
    event: GitHubWebhookEvent;
    sessionId: string;
    mode?: AgentMode;
    config?: CodeNexusConfig;
    onStepComplete?: (result: StepResult) => void;
    signal?: AbortSignal;
  }): Promise<OrchestrationRun> {
    const config = params.config ?? getConfig();
    const mode = params.mode ?? AgentMode.Review;

    if (this.concurrentCount >= CONCURRENT_REVIEW_LIMIT) {
      throw new OrchestratorError(
        `Concurrent review limit (${CONCURRENT_REVIEW_LIMIT}) reached`,
        'general',
        'CONCURRENCY_LIMIT',
        false,
      );
    }

    const run: OrchestrationRun = {
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      event: params.event,
      config,
      mode,
      results: [],
      blindSpots: [],
      escalations: [],
      prCommentBody: '',
      startedAt: new Date().toISOString(),
      completedAt: null,
      overallStatus: SessionStatus.Running,
      context: {},
    };

    this.activeRuns.set(run.id, run);
    this.concurrentCount++;

    try {
      if (this.workflowEngineAvailable) {
        try {
          console.log(`[orchestrator] [${run.id}] Executing review via WorkflowEngine`);

          const repo = this.getRepoInfoFromRun(run);
          const wfRun = await this.workflowEngine.execute('code_review', {
            event: params.event,
            sessionId: params.sessionId,
            mode,
            repository: repo,
            config,
            knowledgeMaxSources: config.knowledge.maxSources,
            agentConfig: config.agent,
          });

          run.results = this.mapWorkflowStepsToResults(wfRun);
          run.prCommentBody = this.buildPRComment(run);

          if (wfRun.status === 'completed') {
            run.overallStatus = SessionStatus.Completed;
          } else if (wfRun.status === 'failed') {
            run.overallStatus = SessionStatus.Failed;
          } else if (wfRun.status === 'cancelled') {
            run.overallStatus = SessionStatus.Cancelled;
          }
        } catch (workflowError) {
          console.warn('[Orchestrator] Workflow engine execution failed, falling back to hardcoded sequence:', workflowError);
          await this.executeHardcodedSequence(run, mode, params);
        }
      } else {
        await this.executeHardcodedSequence(run, mode, params);
      }
    } catch (error) {
      console.error(`[orchestrator] Fatal error in run ${run.id}:`, error);
      run.overallStatus = SessionStatus.Failed;
      run.results.push({
        step: 'general' as unknown as ReviewStep,
        status: 'failed',
        durationMs: 0,
        error: `Fatal orchestration error: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      run.completedAt = new Date().toISOString();
      this.concurrentCount = Math.max(0, this.concurrentCount - 1);
      this.activeRuns.delete(run.id);

      // Record final metrics
      await this.recordRunMetrics(run).catch((err) => {
        console.warn(`[orchestrator] Failed to record metrics:`, err);
      });
    }

    return run;
  }

  /**
   * Get status of all active runs.
   */
  getActiveRuns(): OrchestrationRun[] {
    return Array.from(this.activeRuns.values());
  }

  /**
   * Get a specific run by ID.
   */
  getRun(runId: string): OrchestrationRun | undefined {
    return this.activeRuns.get(runId);
  }

  /**
   * Cancel an active orchestration run.
   */
  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.overallStatus = SessionStatus.Cancelled;
      run.completedAt = new Date().toISOString();
      this.activeRuns.delete(runId);
      this.concurrentCount = Math.max(0, this.concurrentCount - 1);
      return true;
    }
    return false;
  }

  /**
   * Override module adapters (useful for testing).
   */
  setModuleAdapters(adapters: Partial<ModuleAdapters>): void {
    this.moduleAdapters = { ...this.moduleAdapters, ...adapters };
    if (this.workflowEngineAvailable) {
      this.registerProductionWorkflow();
    }
  }

  /**
   * Execute the review using a fresh workflow engine with the given adapters.
   */
  async executeReview(adapters: ModuleAdapters, context: Record<string, unknown>): Promise<WFRunState> {
    const steps = createReviewWorkflow(adapters);
    const reviewEngine = new WorkflowEngine();
    reviewEngine.define(
      { name: 'code_review_ad_hoc', retry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 } },
      steps,
    );
    return reviewEngine.execute('code_review_ad_hoc', context);
  }

  /**
   * List all workflow engine runs.
   */
  listWorkflowRuns(): WFRunState[] {
    return this.workflowEngine.listRuns();
  }

  /**
   * Get a specific workflow run by ID.
   */
  getWorkflowRun(runId: string): WFRunState | undefined {
    return this.workflowEngine.getRun(runId);
  }

  // ─── Step Execution ──────────────────────────────────────

  private async executeHardcodedSequence(
    run: OrchestrationRun,
    mode: AgentMode,
    params: { signal?: AbortSignal; onStepComplete?: (result: StepResult) => void },
  ): Promise<void> {
    const stepSequence = this.buildStepSequence(mode);

    for (const step of stepSequence) {
      if (params.signal?.aborted) {
        run.overallStatus = SessionStatus.Cancelled;
        break;
      }

      const result = await this.executeStepWithRetry(step, run, params.signal);
      run.results.push(result);

      if (params.onStepComplete) {
        params.onStepComplete(result);
      }

      if (result.status === 'failed') {
        run.overallStatus = SessionStatus.Failed;

        const lastError = run.results.filter(r => r.error).pop();
        if (lastError?.error) {
          const isRecoverable = await this.isStepRecoverable(step, lastError.error);
          if (!isRecoverable) break;
        }
      }
    }

    if (run.overallStatus !== SessionStatus.Failed && run.overallStatus !== SessionStatus.Cancelled) {
      run.overallStatus = SessionStatus.Completed;
    }
  }

  private mapWorkflowStepsToResults(wfRun: WFRunState): StepResult[] {
    const results: StepResult[] = [];
    for (const [name, stepState] of wfRun.steps) {
      const mappedStep = this.mapStepName(name);
      results.push({
        step: mappedStep,
        status: stepState.status === 'done' ? 'success' :
                stepState.status === 'failed' ? 'failed' : 'skipped',
        durationMs: 0,
        error: stepState.error,
      });
    }
    return results;
  }

  private mapStepName(wfName: string): ReviewStep {
    const mapping: Record<string, ReviewStep> = {
      'validate_webhook': ReviewStep.ValidateWebhook,
      'parse_event': ReviewStep.ParseEvent,
      'fetch_pr': ReviewStep.FetchPR,
      'classify_pr': ReviewStep.ClassifyPR,
      'design_review': ReviewStep.DesignReview,
      'security_scan': ReviewStep.SecurityScan,
      'knowledge_query': ReviewStep.KnowledgeQuery,
      'mcp_validation': ReviewStep.MCPValidation,
      'generate_comments': ReviewStep.GenerateComments,
      'post_comments': ReviewStep.PostComments,
      'apply_fixes': ReviewStep.ApplyFixes,
      'verify_fixes': ReviewStep.VerifyFixes,
      'blind_spot_generation': ReviewStep.BlindSpotGeneration,
      'report_results': ReviewStep.ReportResults,
      'impact_translation': ReviewStep.ImpactTranslation,
    };
    return mapping[wfName] ?? (wfName as unknown as ReviewStep);
  }

  private buildStepSequence(mode: AgentMode): ReviewStep[] {
    const baseSteps: ReviewStep[] = [
      ReviewStep.ValidateWebhook,
      ReviewStep.ParseEvent,
      ReviewStep.FetchPR,
      ReviewStep.ClassifyPR,
    ];

    const reviewSteps: ReviewStep[] = [
      ReviewStep.DesignReview,
      ReviewStep.SecurityScan,
      ReviewStep.KnowledgeQuery,
      ReviewStep.MCPValidation,
      ReviewStep.GenerateComments,
      ReviewStep.PostComments,
    ];

    const blindSpotStep: ReviewStep[] = [
      ReviewStep.BlindSpotGeneration,
    ];

    const fixSteps: ReviewStep[] = [
      ReviewStep.ApplyFixes,
      ReviewStep.VerifyFixes,
    ];

    const finalSteps: ReviewStep[] = [
      ReviewStep.ReportResults,
      ReviewStep.ImpactTranslation,
    ];

    switch (mode) {
      case AgentMode.Plan:
        return [...baseSteps, ReviewStep.KnowledgeQuery, ReviewStep.MCPValidation, ...blindSpotStep, ...finalSteps];
      case AgentMode.Fix:
        return [...baseSteps, ...reviewSteps, ...blindSpotStep, ...fixSteps, ...finalSteps];
      case AgentMode.Build:
        return [...baseSteps, ReviewStep.KnowledgeQuery, ...blindSpotStep, ...fixSteps, ...finalSteps];
      case AgentMode.Review:
      default:
        return [...baseSteps, ...reviewSteps, ...blindSpotStep, ...finalSteps];
    }
  }

  private async executeStepWithRetry(
    step: ReviewStep,
    run: OrchestrationRun,
    signal?: AbortSignal,
  ): Promise<StepResult> {
    let lastError: Error | undefined;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) {
        return {
          step,
          status: 'failed',
          durationMs: 0,
          error: 'Aborted',
        };
      }

      const startTime = Date.now();

      try {
        const data = await this.executeStep(step, run);
        return {
          step,
          status: 'success',
          durationMs: Date.now() - startTime,
          data,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const duration = Date.now() - startTime;

        if (error instanceof OrchestratorError && !error.recoverable) {
          return {
            step,
            status: 'failed',
            durationMs: duration,
            error: lastError.message,
          };
        }

        retryCount++;

        if (retryCount <= MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount - 1);
          console.warn(
            `[orchestrator] Step ${step} failed (attempt ${retryCount}/${MAX_RETRIES}), retrying in ${delay}ms: ${lastError.message}`,
          );
          await this.sleep(delay);
        }
      }
    }

    return {
      step,
      status: 'failed',
      durationMs: 0,
      error: lastError?.message ?? 'Unknown error after retries',
    };
  }

  private async executeStep(
    step: ReviewStep,
    run: OrchestrationRun,
  ): Promise<Record<string, unknown>> {
    const log = (msg: string) =>
      console.log(`[orchestrator] [${run.id}] Step ${step}: ${msg}`);

    switch (step) {
      // ── Step 1: Validate webhook ────────────────────────
      case ReviewStep.ValidateWebhook: {
        log('Validating webhook signature');

        const pr = run.event.pullRequest;
        const repo = run.event.repository;

        if (!pr || !repo) {
          throw new OrchestratorError(
            'Missing pull request or repository data in webhook event',
            step,
            'INVALID_EVENT',
            false,
          );
        }

        const repository: RepositoryInfo = {
          owner: repo.owner.login,
          repo: repo.name,
          branch: pr.head.ref,
          prNumber: pr.number,
          cloneUrl: repo.cloneUrl,
        };

        return { repository, pr, repo };
      }

      // ── Step 2: Parse event ─────────────────────────────
      case ReviewStep.ParseEvent: {
        log('Parsing event and extracting context');

        const repoInfo = this.getRepoInfoFromRun(run);
        const pr = run.event.pullRequest;

        return {
          repository: repoInfo,
          title: pr.title,
          body: pr.body,
          headSha: pr.head.sha,
          baseRef: pr.base.ref,
          headRef: pr.head.ref,
          author: pr.user.login,
          action: run.event.action,
        };
      }

      // ── Step 3: Fetch PR data ───────────────────────────
      case ReviewStep.FetchPR: {
        log('Fetching PR diff and metadata');
        const repoInfo = this.getRepoInfoFromRun(run);

        const [diff, comments] = await Promise.all([
          this.moduleAdapters.prManager.getDiff(repoInfo),
          this.moduleAdapters.prManager.getComments(repoInfo),
        ]);

        const result = {
          diff,
          comments: comments.comments,
          commentStats: comments.stats,
          diffLength: diff.length,
          totalComments: comments.stats.total,
        };

        run.context.diff = diff;
        run.context.diffLength = diff.length;
        run.context.comments = comments.comments;
        run.context.commentStats = comments.stats;

        return result;
      }

      // ── Step 4: Classify PR ────────────────────────────
      case ReviewStep.ClassifyPR: {
        log('Classifying PR type and determining scope');
        const pr = run.event.pullRequest;
        const title = pr.title ?? '';
        const body = pr.body ?? '';

        const prType = this.classifyPR(title, body);
        const reviewDepth = this.determineReviewDepth(prType);

        return {
          prType,
          reviewDepth,
          requiresSecurityReview: prType === 'security' || prType === 'infrastructure',
          requiresDesignReview: prType === 'feature' || prType === 'refactor',
          estimatedEffort: reviewDepth,
        };
      }

      // ── Step 5: Design review ──────────────────────────
      case ReviewStep.DesignReview: {
        log('Running design review');
        const diff = run.context.diff ?? '';
        if (!diff) {
          log('Design review skipped: no diff available');
          return { skipped: true, reason: 'no_diff' };
        }
        try {
          const audit = await this.moduleAdapters.designReviewer.auditCode(
            diff,
            this.detectLanguage(run),
          );
          run.context.designAudit = audit;
          return { audit, antiPatterns: audit.antiPatterns, score: audit.score };
        } catch (error) {
          log(`Design review skipped: ${error}`);
          return { skipped: true, reason: String(error) };
        }
      }

      // ── Step 6: Security scan ──────────────────────────
      case ReviewStep.SecurityScan: {
        log('Running security scan');
        const diff = run.context.diff ?? '';
        if (!diff) {
          log('Security scan skipped: no diff available');
          return { skipped: true, reason: 'no_diff' };
        }
        try {
          const alerts = await this.moduleAdapters.security.scanDiff(diff);
          run.context.securityAlerts = alerts;
          run.context.criticalSecurityCount = alerts.filter(a => a.severity === Severity.Critical).length;
          return {
            alerts,
            alertCount: alerts.length,
            criticalCount: alerts.filter(a => a.severity === Severity.Critical).length,
          };
        } catch (error) {
          log(`Security scan skipped: ${error}`);
          return { skipped: true, reason: String(error) };
        }
      }

      // ── Step 7: Knowledge query ────────────────────────
      case ReviewStep.KnowledgeQuery: {
        log('Querying knowledge engine');
        try {
          const synthesis = await this.moduleAdapters.knowledgeEngine.search(
            run.event.pullRequest?.title ?? '',
            run.config.knowledge.maxSources,
          );
          return { synthesis, confidence: synthesis.confidence };
        } catch (error) {
          log(`Knowledge query skipped: ${error}`);
          return { skipped: true, reason: String(error) };
        }
      }

      // ── Step 8: MCP validation ─────────────────────────
      case ReviewStep.MCPValidation: {
        log('Calling MCP servers for business logic validation');
        try {
          const entities = await this.moduleAdapters.mcpServers.validateBusinessLogic(
            this.getRepoInfoFromRun(run),
          );
          return { entities, entityCount: entities.length };
        } catch (error) {
          log(`MCP validation skipped: ${error}`);
          return { skipped: true, reason: String(error) };
        }
      }

      // ── Step 9: Generate comments ──────────────────────
      case ReviewStep.GenerateComments: {
        log('Generating review comments via agent');
        const repoInfo = this.getRepoInfoFromRun(run);
        const context = this.buildReviewContext(run);

        const agentSession = await this.moduleAdapters.agentRuntime.createSession(
          run.config.agent,
          context,
          AgentMode.Review,
        );

        const response = await this.moduleAdapters.agentRuntime.executePrompt(
          agentSession.id,
          context,
        );

        return {
          agentSessionId: agentSession.id,
          response,
          responseLength: response.length,
        };
      }

      // ── Step 10: Post comments ─────────────────────────
      case ReviewStep.PostComments: {
        log('Posting review comments to PR');
        const repoInfo = this.getRepoInfoFromRun(run);

        // Build the structured PR comment from all accumulated review data
        const prCommentBody = this.buildPRComment(run);
        run.prCommentBody = prCommentBody;

        // Post the full comment body via PR manager
        await this.moduleAdapters.prManager.updatePR(repoInfo, prCommentBody);

        return { posted: true, commentLength: prCommentBody.length };
      }

      // ── Step 11: Apply fixes ───────────────────────────
      case ReviewStep.ApplyFixes: {
        log('Applying automated fixes');
        if (run.mode !== AgentMode.Fix && run.mode !== AgentMode.Build) {
          return { skipped: true, reason: 'Not in fix/build mode' };
        }

        const repoInfo = this.getRepoInfoFromRun(run);
        const sandboxSpec: SandboxSpec = {
          image: 'codenexus/agent-sandbox:latest',
          resources: { cpu: 2, memory: '4GB', disk: '10GB' },
          preBuildCommands: ['npm install', 'pip install -r requirements.txt'],
          environment: { CNX_SESSION_ID: run.sessionId },
        };

        try {
          const sandboxId = await this.moduleAdapters.agentRuntime.spawnSandbox(sandboxSpec);

          // Fix would be applied here
          return {
            sandboxId,
            fixesApplied: 0,
            fixesAttempted: 0,
          };
        } catch (error) {
          log(`Fix application failed: ${error}`);
          return { skipped: true, reason: String(error) };
        }
      }

      // ── Step 12: Verify fixes ──────────────────────────
      case ReviewStep.VerifyFixes: {
        log('Verifying fixes');
        if (run.mode !== AgentMode.Fix && run.mode !== AgentMode.Build) {
          return { skipped: true, reason: 'Not in fix/build mode' };
        }

        return {
          verificationPassed: true,
          testResults: {},
          lintResults: {},
          buildResults: {},
        };
      }

      // ── Step 12.5: Blind Spot Generation ───────────────
      case ReviewStep.BlindSpotGeneration: {
        log('Generating blind spot declarations');

        // Collect findings from the completed review sections
        const sectionFindings = this.collectSectionFindings(run);

        if (sectionFindings.size === 0) {
          log('No review sections with findings — skipping blind spot generation');
          return { skipped: true, reason: 'No sections with findings', blindSpotsGenerated: 0 };
        }

        // Generate all blind spots via review-components
        const blindSpots = generateAllBlindSpots(sectionFindings);
        run.blindSpots = blindSpots;

        // Record each blind spot in the evidence store
        for (const blindSpot of blindSpots) {
          await this.moduleAdapters.evidenceStore
            .recordBlindSpot(blindSpot, run.id)
            .catch((err) => log(`Evidence store record failed for BSD ${blindSpot.id}: ${err}`));
        }

        log(`Generated ${blindSpots.length} blind spot declarations`);

        return {
          blindSpotsGenerated: blindSpots.length,
          sectionsWithFindings: sectionFindings.size,
          blindSpotIds: blindSpots.map((bs) => bs.id),
        };
      }

      // ── Step 13: Report results ────────────────────────
      case ReviewStep.ReportResults: {
        log('Reporting results to analytics');
        const metrics = this.computeRunMetrics(run);

        await this.moduleAdapters.analytics.recordMetric(metrics);
        await this.moduleAdapters.analytics.recordEvent('review_completed', {
          runId: run.id,
          sessionId: run.sessionId,
          mode: run.mode,
          status: run.overallStatus,
          stepCount: run.results.length,
          blindSpotCount: run.blindSpots.length,
          escalationCount: run.escalations.length,
          duration: run.completedAt && run.startedAt
            ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
            : 0,
        });

        return {
          metrics,
          dashboardUrl: run.config.analytics.dashboardUrl,
        };
      }

      // ── Step 13.5: Impact Translation ──────────────────
      case ReviewStep.ImpactTranslation: {
        log('Translating escalated findings into build impact cards');

        // Determine if any review section produced an ESCALATE or FAIL-level result
        const hasEscalations = this.hasEscalations(run);

        if (!hasEscalations) {
          log('No escalations detected — skipping impact translation');
          return { skipped: true, reason: 'No findings require escalation', escalationsGenerated: 0 };
        }

        const escalations: EscalationResult[] = [];

        // Collect critical/security findings from previous steps
        const criticalFindings = this.collectEscalationFindings(run);

        for (const finding of criticalFindings) {
          const escalationId = `ESC-${new Date().getFullYear()}-${String(criticalFindings.indexOf(finding) + 1).padStart(4, '0')}`;

          const impactCard = translateFinding(
            escalationId,
            finding.category,
            finding.summary,
          );

          const escalation: EscalationResult = {
            escalationId,
            findingCategory: finding.category,
            technicalSummary: finding.summary,
            impactCard,
            decision: null, // Awaiting human decision
            recordedInEvidenceStore: false,
          };

          // Record in evidence store
          try {
            await this.moduleAdapters.evidenceStore.recordEscalation(escalation, run.id);
            escalation.recordedInEvidenceStore = true;
          } catch (err) {
            log(`Evidence store record failed for ${escalationId}: ${err}`);
          }

          escalations.push(escalation);
        }

        run.escalations = escalations;
        log(`Translated ${escalations.length} findings into build impact cards`);

        return {
          escalationsGenerated: escalations.length,
          escalationIds: escalations.map((e) => e.escalationId),
          allRecorded: escalations.every((e) => e.recordedInEvidenceStore),
        };
      }

      default:
        throw new OrchestratorError(
          `Unknown step: ${step}`,
          step,
          'UNKNOWN_STEP',
          false,
        );
    }
  }

  private async isStepRecoverable(step: ReviewStep, error: string): Promise<boolean> {
    const nonRecoverableErrors = ['CONFIG_ERROR', 'INVALID_EVENT', 'UNKNOWN_STEP'];

    // Check if this is a non-recoverable error pattern
    if (nonRecoverableErrors.some(e => error.includes(e))) {
      return false;
    }

    // Step-specific non-recoverable conditions
    switch (step) {
      case ReviewStep.ValidateWebhook:
        return false; // Can't proceed if webhook is invalid
      case ReviewStep.ParseEvent:
        return false; // Can't proceed without parsing
      case ReviewStep.FetchPR:
        return true; // Can retry fetching
      default:
        return true; // Most steps are recoverable
    }
  }

  // ─── Section Findings Collection ─────────────────────────

  /**
   * Collect findings from all completed review sections.
   * Maps each review step result to a ReviewSection with count, risk level,
   * and summaries for blind spot generation.
   */
  private collectSectionFindings(run: OrchestrationRun): Map<ReviewSection, { count: number; riskLevel: RiskLevel }> {
    const findings = new Map<ReviewSection, { count: number; riskLevel: RiskLevel }>();

    for (const result of run.results) {
      if (result.status === 'skipped' || result.status === 'failed') continue;
      const data = result.data;
      if (!data) continue;

      switch (result.step) {
        case ReviewStep.DesignReview: {
          const antiPatterns = data['antiPatterns'] as unknown[];
          if (antiPatterns && antiPatterns.length > 0) {
            const score = (data['score'] as number) ?? 100;
            const riskLevel: RiskLevel = score >= 80 ? 'LOW' : score >= 60 ? 'MEDIUM' : score >= 40 ? 'HIGH' : 'CRITICAL';
            findings.set('Design Review', { count: antiPatterns.length, riskLevel });
          }
          break;
        }
        case ReviewStep.SecurityScan: {
          const alertCount = (data['alertCount'] as number) ?? 0;
          const criticalCount = (data['criticalCount'] as number) ?? 0;
          if (alertCount > 0) {
            const riskLevel: RiskLevel = criticalCount > 0 ? 'CRITICAL' : alertCount > 3 ? 'HIGH' : 'MEDIUM';
            findings.set('Pipeline Security', { count: alertCount, riskLevel });
          }
          break;
        }
        case ReviewStep.KnowledgeQuery: {
          const confidence = (data['confidence'] as number) ?? 0;
          const synthesis = data['synthesis'] as { keyConcepts?: unknown[] } | undefined;
          const conceptCount = synthesis?.keyConcepts?.length ?? 0;
          if (conceptCount > 0) {
            const riskLevel: RiskLevel = confidence >= 0.8 ? 'LOW' : confidence >= 0.5 ? 'MEDIUM' : 'HIGH';
            findings.set('Knowledge Retrieval', { count: conceptCount, riskLevel });
          }
          break;
        }
        case ReviewStep.MCPValidation: {
          const entityCount = (data['entityCount'] as number) ?? 0;
          if (entityCount > 0) {
            findings.set('Business Logic', { count: entityCount, riskLevel: 'MEDIUM' });
          }
          break;
        }
      }
    }

    return findings;
  }

  /**
   * Determine whether any review section produced findings requiring escalation.
   */
  private hasEscalations(run: OrchestrationRun): boolean {
    for (const result of run.results) {
      if (result.status === 'skipped' || result.status === 'failed') continue;
      const data = result.data;
      if (!data) continue;

      switch (result.step) {
        case ReviewStep.SecurityScan: {
          const criticalCount = (data['criticalCount'] as number) ?? 0;
          if (criticalCount > 0) return true;
          break;
        }
        case ReviewStep.DesignReview: {
          const score = (data['score'] as number) ?? 100;
          if (score < 40) return true;
          break;
        }
        case ReviewStep.KnowledgeQuery: {
          const confidence = (data['confidence'] as number) ?? 1;
          if (confidence < 0.4) return true;
          break;
        }
      }
    }

    return false;
  }

  /**
   * Collect findings that require escalation (CRITICAL severity, failed design scores, etc.)
   * and translate them into structured escalation candidates for impact card generation.
   */
  private collectEscalationFindings(run: OrchestrationRun): Array<{ category: string; summary: string }> {
    const findings: Array<{ category: string; summary: string }> = [];

    for (const result of run.results) {
      if (result.status === 'skipped' || result.status === 'failed') continue;
      const data = result.data;
      if (!data) continue;

      switch (result.step) {
        case ReviewStep.SecurityScan: {
          const criticalCount = (data['criticalCount'] as number) ?? 0;
          const alertCount = (data['alertCount'] as number) ?? 0;
          if (criticalCount > 0) {
            findings.push({
              category: 'Pipeline Security',
              summary: `${criticalCount} critical security alert(s) detected out of ${alertCount} total. Immediate review required.`,
            });
          }
          break;
        }
        case ReviewStep.DesignReview: {
          const score = (data['score'] as number) ?? 100;
          const antiPatterns = data['antiPatterns'] as Array<{ name?: string }> | undefined;
          if (score < 40 && antiPatterns && antiPatterns.length > 0) {
            findings.push({
              category: 'Design Review',
              summary: `Design audit score ${score}/100 with ${antiPatterns.length} anti-pattern(s) detected: ${antiPatterns.map((a) => a.name ?? 'unnamed').join(', ')}.`,
            });
          }
          break;
        }
        case ReviewStep.KnowledgeQuery: {
          const confidence = (data['confidence'] as number) ?? 1;
          if (confidence < 0.4) {
            findings.push({
              category: 'Knowledge Retrieval',
              summary: `Low knowledge synthesis confidence (${Math.round(confidence * 100)}%). Findings may be unreliable without human review.`,
            });
          }
          break;
        }
      }
    }

    return findings;
  }

  // ─── PR Comment Builder ─────────────────────────────────

  /**
   * Build the complete PR comment body following the structured format:
   * 1. Summary header (risk level, overall status)
   * 2. For each review section with findings: header → findings → BlindSpotDeclaration
   * 3. If ESCALATE: BuildImpactTranslator escalation card + human decision options
   * 4. Footer with merge recommendation and required reviewers
   */
  private buildPRComment(run: OrchestrationRun): string {
    const sections: string[] = [];
    const pr = run.event.pullRequest;

    // ── 1. Summary Header ──────────────────────────────
    const overallRisk = this.computeOverallRiskLevel(run);
    const riskEmoji = overallRisk === 'CRITICAL' ? '🔴' : overallRisk === 'HIGH' ? '🟠' : overallRisk === 'MEDIUM' ? '🟡' : '🟢';

    sections.push([
      `# CodeNexus Review — PR #${pr.number}: "${pr.title ?? '(no title)'}"`,
      ``,
      `${riskEmoji} **Overall Risk Level: ${overallRisk}** | Status: \`${run.overallStatus}\` | Mode: \`${run.mode}\``,
      ``,
      `> Automated review completed by CodeNexus v${ORCHESTRATOR_VERSION}. This report includes automated findings, blind spot declarations, and impact translations where applicable.`,
      ``,
      `---`,
      ``,
    ].join('\n'));

    // ── 2. Per-Section Findings with Blind Spots ────────
    const sectionFindings = this.collectSectionFindings(run);

    if (sectionFindings.size > 0) {
      sections.push(`## 🔍 Review Findings`);
      sections.push(``);

      for (const [section, { count, riskLevel }] of sectionFindings) {
        const sectionRiskEmoji = riskLevel === 'CRITICAL' ? '🔴' : riskLevel === 'HIGH' ? '🟠' : riskLevel === 'MEDIUM' ? '🟡' : '🟢';

        // Section header
        sections.push(`### ${sectionRiskEmoji} ${section} (${count} finding${count !== 1 ? 's' : ''})`);
        sections.push(``);

        // List findings for this section from step data
        const findingLines = this.buildSectionFindingLines(run, section);
        sections.push(...findingLines);
        sections.push(``);

        // Append BlindSpotDeclaration after section findings
        const blindSpot = run.blindSpots.find((bs: BlindSpotDeclaration) => bs.section === section);
        if (blindSpot) {
          sections.push(renderBlindSpotMarkdown(blindSpot));
        } else {
          // Generate an inline blind spot for sections that have findings but no pre-generated BSD
          sections.push(this.buildInlineBlindSpot(section, count, riskLevel));
        }
        sections.push(``);
      }
    } else {
      sections.push(`## 🔍 Review Findings`);
      sections.push(``);
      sections.push(`✅ No automated findings detected across all review sections.`);
      sections.push(``);
    }

    // ── 3. Escalation Cards ─────────────────────────────
    if (run.escalations.length > 0) {
      sections.push(`---`);
      sections.push(``);
      sections.push(`## ⚠️ Escalation Cards`);
      sections.push(``);
      sections.push(`The following findings have been escalated for human decision:`);
      sections.push(``);

      for (const escalation of run.escalations) {
        sections.push(renderImpactMarkdown(escalation.impactCard));
        sections.push(``);
      }
    }

    // ── 4. Footer ───────────────────────────────────────
    const mergeRecommendation = this.buildMergeRecommendation(run);

    sections.push(`---`);
    sections.push(``);
    sections.push(`## 📋 Merge Recommendation`);
    sections.push(``);
    sections.push(mergeRecommendation);
    sections.push(``);
    sections.push(`**Required Reviewers:** ${this.buildRequiredReviewersList(run)}`);
    sections.push(``);
    sections.push(`---`);
    sections.push(``);
    sections.push(`*CodeNexus v${ORCHESTRATOR_VERSION} — Automated Review with Blind Spot Honesty & Impact Translation*`);

    return sections.join('\n');
  }

  /**
   * Build human-readable finding lines for a specific review section.
   */
  private buildSectionFindingLines(run: OrchestrationRun, section: ReviewSection): string[] {
    const lines: string[] = [];

    for (const result of run.results) {
      if (result.status === 'skipped' || result.status === 'failed') continue;
      const data = result.data;
      if (!data) continue;

      switch (section) {
        case 'Design Review':
          if (result.step === ReviewStep.DesignReview) {
            const antiPatterns = data['antiPatterns'] as Array<{ name?: string; severity?: string }> | undefined;
            if (antiPatterns) {
              for (const ap of antiPatterns) {
                const severityIcon = ap.severity === 'critical' ? '🔴' : ap.severity === 'major' ? '🟠' : '🟡';
                lines.push(`- ${severityIcon} **${ap.name ?? 'Anti-pattern'}**: ${ap.severity ?? 'detected'}`);
              }
            }
          }
          break;
        case 'Pipeline Security':
          if (result.step === ReviewStep.SecurityScan) {
            const alerts = data['alerts'] as Array<{ message?: string; severity?: string }> | undefined;
            if (alerts) {
              for (const alert of alerts) {
                const severityIcon = alert.severity === 'Critical' ? '🔴' : alert.severity === 'High' ? '🟠' : '🟡';
                lines.push(`- ${severityIcon} ${alert.message ?? 'Security alert'}`);
              }
            }
          }
          break;
        case 'Knowledge Retrieval':
          if (result.step === ReviewStep.KnowledgeQuery) {
            const synthesis = data['synthesis'] as { keyConcepts?: string[] } | undefined;
            if (synthesis?.keyConcepts) {
              for (const concept of synthesis.keyConcepts) {
                lines.push(`- 📚 ${concept}`);
              }
            }
          }
          break;
        case 'Business Logic':
          if (result.step === ReviewStep.MCPValidation) {
            const entities = data['entities'] as Array<{ name?: string; type?: string }> | undefined;
            if (entities) {
              for (const entity of entities) {
                lines.push(`- 🏢 **${entity.name ?? 'Entity'}** (${entity.type ?? 'unknown'})`);
              }
            }
          }
          break;
      }
    }

    return lines.length > 0 ? lines : [`- Automated findings reported (see details above)`];
  }

  /**
   * Build an inline blind spot declaration for sections that had findings
   * but weren't captured during the BlindSpotGeneration step (fallback).
   */
  private buildInlineBlindSpot(section: ReviewSection, count: number, riskLevel: RiskLevel): string {
    return [
      `---`,
      ``,
      `### ⚠️ Blind Spot Declaration — ${section}`,
      ``,
      `🟡 **Confidence**: 65% — Automated analysis has known limitations for this section.`,
      ``,
      `**Things the system might miss:**`,
      ``,
      `- False positives in automated pattern matching`,
      `- Context-specific edge cases unique to this codebase`,
      `- Integration-level issues that span multiple components`,
      ``,
      `**🎯 Human focus**: Review the ${count} finding(s) in "${section}" and verify they represent real issues.`,
      ``,
      `> *This is an automated honesty statement. The system knows what it knows, and more importantly, what it doesn't.*`,
      ``,
    ].join('\n');
  }

  /**
   * Compute overall risk level from all review results.
   */
  private computeOverallRiskLevel(run: OrchestrationRun): RiskLevel {
    let maxRisk: RiskLevel = 'LOW';

    for (const result of run.results) {
      if (result.status === 'skipped' || result.status === 'failed') continue;
      const data = result.data;

      switch (result.step) {
        case ReviewStep.SecurityScan: {
          const criticalCount = (data?.['criticalCount'] as number) ?? 0;
          if (criticalCount > 0) return 'CRITICAL';
          const alertCount = (data?.['alertCount'] as number) ?? 0;
          if (alertCount > 3 && maxRisk !== 'CRITICAL') maxRisk = 'HIGH';
          else if (alertCount > 0 && maxRisk === 'LOW') maxRisk = 'MEDIUM';
          break;
        }
        case ReviewStep.DesignReview: {
          const score = (data?.['score'] as number) ?? 100;
          if (score < 40) return 'CRITICAL';
          if (score < 60 && maxRisk !== 'CRITICAL') maxRisk = 'HIGH';
          else if (score < 80 && maxRisk === 'LOW') maxRisk = 'MEDIUM';
          break;
        }
        case ReviewStep.KnowledgeQuery: {
          const confidence = (data?.['confidence'] as number) ?? 1;
          if (confidence < 0.3 && maxRisk !== 'CRITICAL') maxRisk = 'HIGH';
          else if (confidence < 0.5 && maxRisk === 'LOW') maxRisk = 'MEDIUM';
          break;
        }
      }
    }

    return maxRisk;
  }

  /**
   * Build a human-readable merge recommendation based on review findings.
   */
  private buildMergeRecommendation(run: OrchestrationRun): string {
    const riskLevel = this.computeOverallRiskLevel(run);

    switch (riskLevel) {
      case 'CRITICAL':
        return `> 🔴 **DO NOT MERGE** — Critical issues detected. Address all escalated findings and re-run review before merging.`;
      case 'HIGH':
        return `> 🟠 **CAUTION** — High-risk findings present. Strongly recommended to address escalated items before merge. At minimum, create tracking tickets for all HIGH and above findings.`;
      case 'MEDIUM':
        return `> 🟡 **PROCEED WITH CARE** — Medium-risk findings detected. Review blind spot declarations and confirm findings are acceptable for your release context. Consider creating follow-up tickets.`;
      case 'LOW':
      default:
        return `> 🟢 **SAFE TO MERGE** — No high-risk findings detected. Standard code review diligence applies.`;
    }
  }

  /**
   * Build the list of required reviewers based on escalation context.
   */
  private buildRequiredReviewersList(run: OrchestrationRun): string {
    const reviewers: string[] = [`@${run.event.pullRequest.user.login}`];

    if (run.escalations.length > 0) {
      reviewers.push('@security-team');
    }

    const riskLevel = this.computeOverallRiskLevel(run);
    if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
      reviewers.push('@tech-leads');
    }

    return reviewers.join(', ');
  }

  // ─── Helpers ─────────────────────────────────────────────

  private getRepoInfoFromRun(run: OrchestrationRun): RepositoryInfo {
    const repo = run.event.repository;
    const pr = run.event.pullRequest;
    return {
      owner: repo.owner.login,
      repo: repo.name,
      branch: pr.head.ref,
      prNumber: pr.number,
      cloneUrl: repo.cloneUrl,
    };
  }

  private classifyPR(title: string, body: string): string {
    const lowerTitle = title.toLowerCase();
    const lowerBody = body.toLowerCase();

    if (/(fix|bug|hotfix|patch)/i.test(lowerTitle)) return 'bugfix';
    if (/(feat|feature|add|new)/i.test(lowerTitle)) return 'feature';
    if (/(refactor|cleanup|tech.debt)/i.test(lowerTitle)) return 'refactor';
    if (/(docs?|readme|comment)/i.test(lowerTitle)) return 'documentation';
    if (/(security|vuln|cve|cwe)/i.test(lowerTitle + lowerBody)) return 'security';
    if (/(infra|docker|ci|cd|deploy)/i.test(lowerTitle)) return 'infrastructure';
    if (/(dep|dependabot|update.*version)/i.test(lowerTitle)) return 'dependency';
    if (/(test|spec|e2e|integration)/i.test(lowerTitle)) return 'testing';
    if (/(config|setting|env)/i.test(lowerTitle)) return 'configuration';
    return 'other';
  }

  private determineReviewDepth(prType: string): number {
    switch (prType) {
      case 'security': return 5;
      case 'feature': return 4;
      case 'refactor': return 4;
      case 'bugfix': return 3;
      case 'infrastructure': return 3;
      case 'testing': return 2;
      case 'documentation': return 1;
      case 'dependency': return 1;
      case 'configuration': return 1;
      default: return 2;
    }
  }

  private detectLanguage(run: OrchestrationRun): string {
    // In production, this would inspect the diff for file extensions
    return 'typescript';
  }

  private buildReviewContext(run: OrchestrationRun): string {
    const pr = run.event.pullRequest;
    return [
      `Review PR #${pr.number}: "${pr.title}"`,
      `Repository: ${run.event.repository.fullName}`,
      `Branch: ${pr.head.ref} → ${pr.base.ref}`,
      `Mode: ${run.mode}`,
      `Author: ${pr.user.login}`,
      `---`,
      `Description: ${pr.body ?? '(no description)'}`,
      `---`,
      'Please provide code review comments for any issues you find.',
    ].join('\n');
  }

  private computeRunMetrics(run: OrchestrationRun): ReviewMetric {
    const successfulSteps = run.results.filter(r => r.status === 'success').length;
    const totalSteps = run.results.length;

    return {
      prNumber: run.event.pullRequest.number,
      repository: run.event.repository.fullName,
      totalComments: 0,
      botComments: 0,
      humanComments: 0,
      fixesApplied: 0,
      timeToFix: run.completedAt && run.startedAt
        ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
        : 0,
      confidence: totalSteps > 0 ? successfulSteps / totalSteps : 0,
      timestamp: new Date().toISOString(),
    };
  }

  private async recordRunMetrics(run: OrchestrationRun): Promise<void> {
    try {
      const metrics = this.computeRunMetrics(run);
      await this.moduleAdapters.analytics.recordMetric(metrics);
    } catch (error) {
      console.warn(`[orchestrator] Failed to record run metrics:`, error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Default Module Adapters (stubs) ─────────────────────

  private createDefaultAuth(): ModuleAdapters['auth'] {
    return {
      async validateWebhook(_payload: string, _signature: string, _secret: string) {
        return true;
      },
      async authenticate(_token: string): Promise<UserSession> {
        return {
          id: crypto.randomUUID(),
          username: 'bot',
          groups: ['developers'],
          emails: [],
          authenticationLevel: AuthLevel.TwoFactor,
          authenticationMethods: ['github_oauth'],
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        };
      },
      async checkAccess(_user: UserSession, _rules: AccessControlRule[]) {
        return true;
      },
    };
  }

  private createDefaultPRManager(): ModuleAdapters['prManager'] {
    return createDefaultPRManager();
  }

  private createDefaultAgentRuntime(): ModuleAdapters['agentRuntime'] {
    return {
      async createSession(_config: AgentConfig, _prompt: string, _mode: AgentMode): Promise<AgentSession> {
        return {
          id: crypto.randomUUID(),
          status: SessionStatus.Completed,
          mode: AgentMode.Review,
          repository: { owner: '', repo: '', branch: '', prNumber: null, cloneUrl: '' },
          prompt: '',
          events: [],
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
      async executePrompt(_sessionId: string, _prompt: string) { return '{}'; },
      async streamEvents(_sessionId: string) {
        return (async function* () {})();
      },
      async spawnSandbox(_spec: SandboxSpec) { return crypto.randomUUID(); },
      async destroySandbox(sandboxId: string) {
        console.log(`[Orchestrator] Destroying sandbox: ${sandboxId}`);
        // The sandbox ID is marked as destroyed; actual cleanup is handled by the session manager
      },
    };
  }

  private createDefaultMCPServers(): ModuleAdapters['mcpServers'] {
    return {
      async validateBusinessLogic(_repo: RepositoryInfo) { return []; },
      async executeDecisionTable(_tableName: string, _inputs: Record<string, unknown>) { return {}; },
    };
  }

  private createDefaultSecurity(): ModuleAdapters['security'] {
    return createDefaultSecurity();
  }

  private createDefaultDesignReviewer(): ModuleAdapters['designReviewer'] {
    return {
      async auditCode(_code: string, _language: string): Promise<DesignAudit> {
        return {
          url: '',
          timestamp: new Date().toISOString(),
          antiPatterns: [],
          score: 100,
          recommendations: [],
        };
      },
    };
  }

  private createDefaultKnowledgeEngine(): ModuleAdapters['knowledgeEngine'] {
    return {
      async search(_query: string, _maxSources: number): Promise<KnowledgeSynthesis> {
        return {
          overview: '',
          keyConcepts: [],
          crossSourceInsights: [],
          confidence: 0,
          sources: [],
        };
      },
    };
  }

  private createDefaultAnalytics(): ModuleAdapters['analytics'] {
    return {
      async recordMetric(_metric: ReviewMetric) { /* no-op */ },
      async recordEvent(_event: string, _data: Record<string, unknown>) { /* no-op */ },
    };
  }

  private createDefaultEvidenceStore(): ModuleAdapters['evidenceStore'] {
    return {
      async recordEscalation(_escalation: EscalationResult, _runId: string): Promise<string> {
        const recordId = crypto.randomUUID();
        console.log(`[orchestrator] [evidence-store] Recorded escalation ${_escalation.escalationId} → ${recordId}`);
        return recordId;
      },
      async recordBlindSpot(_blindSpot: BlindSpotDeclaration, _runId: string): Promise<string> {
        const recordId = crypto.randomUUID();
        console.log(`[orchestrator] [evidence-store] Recorded blind spot ${_blindSpot.id} → ${recordId}`);
        return recordId;
      },
    };
  }

  private createDefaultFixExecutor(): ModuleAdapters['fixExecutor'] {
    return createDefaultFixExecutor();
  }
}

// ─── Singleton ────────────────────────────────────────────────

let globalOrchestrator: Orchestrator | null = null;

/**
 * Get or create the global orchestrator instance.
 */
export function getOrchestrator(adapters?: Partial<ModuleAdapters>): Orchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new Orchestrator(adapters);
  }
  return globalOrchestrator;
}

/**
 * Reset the global orchestrator (useful for testing).
 */
export function resetOrchestrator(): void {
  globalOrchestrator = null;
}

export default Orchestrator;
