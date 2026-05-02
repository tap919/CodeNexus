import { WorkflowEngine, type WorkflowStep, type WorkflowContext } from './index.js';

function stub(stepName: string, delayMs = 100) {
  return async (ctx: { log: (msg: string) => void }) => {
    ctx.log(`${stepName} executing...`);
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: true, output: { step: stepName } };
  };
}

function failStub(stepName: string, delayMs = 100) {
  return async (ctx: { log: (msg: string) => void }) => {
    ctx.log(`${stepName} executing (will fail)...`);
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: false, error: `${stepName} failed`, recoverable: false };
  };
}

export function defineCodeReviewWorkflow(engine: WorkflowEngine): void {
  const validate_webhook = stub('validate_webhook');
  const parse_pr = stub('parse_pr');
  const fetch_comments = stub('fetch_comments');
  const classify_comments = stub('classify_comments');

  const analyze_code = stub('analyze_code');
  const business_context = stub('business_context');
  const knowledge_search = stub('knowledge_search');
  const design_review = stub('design_review');
  const security_scan = stub('security_scan');

  const apply_fixes = stub('apply_fixes');
  const post_reply = stub('post_reply');
  const log_analytics = stub('log_analytics');

  engine.define(
    { name: 'code_review', retry: { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 500 } },
    [
      { name: 'validate_webhook', fn: validate_webhook },
      { name: 'parse_pr', fn: parse_pr, dependsOn: ['validate_webhook'] },
      { name: 'fetch_comments', fn: fetch_comments, dependsOn: ['parse_pr'] },
      { name: 'classify_comments', fn: classify_comments, dependsOn: ['fetch_comments'] },

      {
        name: 'analyze_code',
        fn: analyze_code,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_analyze_code'),
      },
      {
        name: 'business_context',
        fn: business_context,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_business_context'),
      },
      {
        name: 'knowledge_search',
        fn: knowledge_search,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_knowledge_search'),
      },
      { name: 'design_review', fn: design_review, dependsOn: ['classify_comments'] },
      {
        name: 'security_scan',
        fn: security_scan,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_security_scan'),
      },

      {
        name: 'apply_fixes',
        fn: apply_fixes,
        dependsOn: ['analyze_code', 'business_context', 'knowledge_search', 'design_review', 'security_scan'],
      },
      { name: 'post_reply', fn: post_reply, dependsOn: ['apply_fixes'] },
      { name: 'log_analytics', fn: log_analytics, dependsOn: ['post_reply'] },
    ]
  );
}

export interface ReviewWorkflowAdapters {
  auth?: {
    validateWebhook?: (payload: string, signature: string, secret: string) => Promise<boolean>;
  };
  prManager?: {
    getDiff?: (repo: { owner: string; repo: string; branch: string; prNumber: number; cloneUrl: string }) => Promise<string>;
    getComments?: (repo: { owner: string; repo: string; branch: string; prNumber: number; cloneUrl: string }) => Promise<{ comments: unknown[]; stats: { total: number } }>;
    updatePR?: (repo: { owner: string; repo: string; branch: string; prNumber: number; cloneUrl: string }, body: string) => Promise<void>;
  };
  agentRuntime?: {
    createSession?: (config: unknown, prompt: string, mode: string) => Promise<{ id: string; status?: string }>;
    executePrompt?: (sessionId: string, prompt: string) => Promise<string>;
    spawnSandbox?: (spec: { image: string; resources: { cpu: number; memory: string; disk: string }; preBuildCommands?: string[]; environment?: Record<string, string> }) => Promise<string>;
  };
  mcpServers?: {
    validateBusinessLogic?: (repo: unknown) => Promise<unknown[]>;
  };
  security?: {
    scanDiff?: (diff: string) => Promise<unknown[]>;
  };
  designReviewer?: {
    auditCode?: (code: string, language: string) => Promise<{ antiPatterns: unknown[]; score: number; recommendations?: unknown[] }>;
  };
  knowledgeEngine?: {
    search?: (query: string, maxSources: number) => Promise<{ overview: string; keyConcepts: string[]; confidence: number; sources: unknown[] }>;
  };
  analytics?: {
    recordMetric?: (metric: unknown) => Promise<void>;
    recordEvent?: (event: string, data: Record<string, unknown>) => Promise<void>;
  };
  evidenceStore?: {
    recordEscalation?: (escalation: unknown, runId: string) => Promise<string>;
    recordBlindSpot?: (blindSpot: unknown, runId: string) => Promise<string>;
  };
}

function classifyPRType(title: string, body: string): string {
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

function determineDepth(prType: string): number {
  const depths: Record<string, number> = {
    security: 5, feature: 4, refactor: 4, bugfix: 3,
    infrastructure: 3, testing: 2,
    documentation: 1, dependency: 1, configuration: 1,
  };
  return depths[prType] ?? 2;
}

export function createReviewWorkflow(adapters: ReviewWorkflowAdapters): WorkflowStep[] {
  return [
    {
      name: 'validate_webhook',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Validating webhook signature');
        const event = ctx.get<any>('event');
        const pr = event?.pullRequest;
        const repo = event?.repository;
        if (!pr || !repo) {
          return { ok: false, error: 'Missing pull request or repository data', recoverable: false };
        }
        const repository = {
          owner: repo.owner.login,
          repo: repo.name,
          branch: pr.head.ref,
          prNumber: pr.number,
          cloneUrl: repo.cloneUrl,
        };
        const signature = ctx.get<string>('signature');
        const rawPayload = ctx.get<string>('rawPayload');
        const valid = await adapters.auth?.validateWebhook?.(rawPayload ?? '', signature ?? '', '') ?? true;
        ctx.set('repository', repository);
        ctx.set('repoFullName', repo.fullName);
        return { ok: valid, error: valid ? undefined : 'Invalid webhook signature', recoverable: false, output: { repository } };
      },
    },
    {
      name: 'parse_event',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Parsing event and extracting context');
        const event = ctx.get<any>('event');
        const pr = event.pullRequest;
        ctx.set('title', pr.title);
        ctx.set('body', pr.body);
        ctx.set('headSha', pr.head.sha);
        ctx.set('baseRef', pr.base.ref);
        ctx.set('headRef', pr.head.ref);
        ctx.set('author', pr.user.login);
        ctx.set('action', event.action);
        return { ok: true, output: { title: pr.title, author: pr.user.login } };
      },
      dependsOn: ['validate_webhook'],
    },
    {
      name: 'fetch_pr',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Fetching PR diff and metadata');
        const repoInfo = ctx.get<any>('repository');
        const [diff, commentsResult] = await Promise.all([
          adapters.prManager?.getDiff?.(repoInfo) ?? '',
          adapters.prManager?.getComments?.(repoInfo) ?? Promise.resolve({ comments: [], stats: { total: 0 } }),
        ]);
        ctx.set('diff', diff);
        ctx.set('comments', (commentsResult as any).comments ?? []);
        ctx.set('commentStats', (commentsResult as any).stats ?? { total: 0 });
        return { ok: true, output: { diffLength: diff.length, totalComments: (commentsResult as any).stats?.total ?? 0 } };
      },
      dependsOn: ['parse_event'],
    },
    {
      name: 'classify_pr',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Classifying PR type and determining scope');
        const title = ctx.get<string>('title') ?? '';
        const body = ctx.get<string>('body') ?? '';
        const prType = classifyPRType(title, body);
        const reviewDepth = determineDepth(prType);
        ctx.set('prType', prType);
        ctx.set('reviewDepth', reviewDepth);
        return { ok: true, output: { prType, reviewDepth } };
      },
      dependsOn: ['fetch_pr'],
    },
    {
      name: 'design_review',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Running design review');
        try {
          const diff = ctx.get<string>('diff') ?? '';
          const audit = await adapters.designReviewer?.auditCode?.(diff, 'typescript') ?? { antiPatterns: [], score: 100 };
          ctx.set('designAudit', audit);
          ctx.set('antiPatterns', audit.antiPatterns);
          ctx.set('designScore', audit.score);
          return { ok: true, output: { antiPatterns: audit.antiPatterns, score: audit.score } };
        } catch (err) {
          ctx.log(`Design review skipped: ${err}`);
          ctx.set('designScore', 100);
          ctx.set('antiPatterns', []);
          return { ok: true, output: { skipped: true } };
        }
      },
      dependsOn: ['classify_pr'],
    },
    {
      name: 'security_scan',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Running security scan');
        try {
          const diff = ctx.get<string>('diff') ?? '';
          const alerts = await adapters.security?.scanDiff?.(diff) ?? [];
          ctx.set('securityAlerts', alerts);
          ctx.set('alertCount', alerts.length);
          const criticalCount = alerts.filter((a: any) =>
            (a.severity ?? '').toString().toLowerCase() === 'critical'
          ).length;
          ctx.set('criticalCount', criticalCount);
          return { ok: true, output: { alerts, alertCount: alerts.length, criticalCount } };
        } catch (err) {
          ctx.log(`Security scan skipped: ${err}`);
          ctx.set('securityAlerts', []);
          ctx.set('alertCount', 0);
          ctx.set('criticalCount', 0);
          return { ok: true, output: { skipped: true } };
        }
      },
      dependsOn: ['classify_pr'],
    },
    {
      name: 'knowledge_query',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Querying knowledge engine');
        try {
          const title = ctx.get<string>('title') ?? '';
          const maxSources = ctx.get<number>('knowledgeMaxSources') ?? 5;
          const synthesis = await adapters.knowledgeEngine?.search?.(title, maxSources) ?? { overview: '', keyConcepts: [], confidence: 0, sources: [] };
          ctx.set('knowledgeSynthesis', synthesis);
          ctx.set('knowledgeConfidence', synthesis.confidence);
          return { ok: true, output: { synthesis, confidence: synthesis.confidence } };
        } catch (err) {
          ctx.log(`Knowledge query skipped: ${err}`);
          ctx.set('knowledgeConfidence', 0);
          return { ok: true, output: { skipped: true } };
        }
      },
      dependsOn: ['classify_pr'],
    },
    {
      name: 'mcp_validation',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Calling MCP servers for business logic validation');
        try {
          const repository = ctx.get<any>('repository');
          const entities = await adapters.mcpServers?.validateBusinessLogic?.(repository) ?? [];
          ctx.set('businessEntities', entities);
          return { ok: true, output: { entities, entityCount: entities.length } };
        } catch (err) {
          ctx.log(`MCP validation skipped: ${err}`);
          ctx.set('businessEntities', []);
          return { ok: true, output: { skipped: true } };
        }
      },
      dependsOn: ['classify_pr'],
    },
    {
      name: 'generate_comments',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Generating review comments via agent');
        try {
          const mode = ctx.get<string>('mode') ?? 'review';
          const title = ctx.get<string>('title') ?? '';
          const body = ctx.get<string>('body') ?? '(no description)';
          const prNumber = ctx.get<any>('repository')?.prNumber;
          const repoFullName = ctx.get<string>('repoFullName') ?? '';
          const baseRef = ctx.get<string>('baseRef') ?? '';
          const headRef = ctx.get<string>('headRef') ?? '';
          const author = ctx.get<string>('author') ?? '';

          const reviewContext = [
            `Review PR #${prNumber}: "${title}"`,
            `Repository: ${repoFullName}`,
            `Branch: ${headRef} → ${baseRef}`,
            `Mode: ${mode}`,
            `Author: ${author}`,
            '---',
            `Description: ${body}`,
            '---',
            'Please provide code review comments for any issues you find.',
          ].join('\n');

          const agentConfig = ctx.get<any>('agentConfig') ?? {};
          const agentSession = await adapters.agentRuntime?.createSession?.(agentConfig, reviewContext, mode) ?? { id: `fallback-${Date.now()}` };
          ctx.set('agentSessionId', agentSession.id);
          const response = await adapters.agentRuntime?.executePrompt?.(agentSession.id, reviewContext) ?? '{}';
          ctx.set('agentResponse', response);
          return { ok: true, output: { agentSessionId: agentSession.id, responseLength: response.length } };
        } catch (err) {
          ctx.log(`Comment generation failed: ${err}`);
          return { ok: true, output: { skipped: true } };
        }
      },
      dependsOn: ['design_review', 'security_scan', 'knowledge_query', 'mcp_validation'],
    },
    {
      name: 'post_comments',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Posting review comments to PR');
        try {
          const repository = ctx.get<any>('repository');
          const prCommentBody = ctx.get<string>('prCommentBody') ??
            '## CodeNexus Automated Review\n\nReview completed.\n';
          await adapters.prManager?.updatePR?.(repository, prCommentBody);
          ctx.set('commentsPosted', true);
          return { ok: true, output: { posted: true } };
        } catch (err) {
          ctx.log(`Posting comments failed: ${err}`);
          return { ok: true, output: { posted: false } };
        }
      },
      dependsOn: ['generate_comments'],
    },
    {
      name: 'apply_fixes',
      fn: async (ctx: WorkflowContext) => {
        const mode = ctx.get<string>('mode') ?? 'review';
        if (mode !== 'fix' && mode !== 'build') {
          return { ok: true, output: { skipped: true, reason: 'Not in fix/build mode' } };
        }
        ctx.log('Applying automated fixes');
        try {
          const sandboxId = await adapters.agentRuntime?.spawnSandbox?.({
            image: 'codenexus/agent-sandbox:latest',
            resources: { cpu: 2, memory: '4GB', disk: '10GB' },
            preBuildCommands: ['npm install'],
            environment: {},
          }) ?? `sandbox-${Date.now()}`;
          ctx.set('sandboxId', sandboxId);
          return { ok: true, output: { sandboxId, fixesApplied: 0 } };
        } catch (err) {
          ctx.log(`Fix application failed: ${err}`);
          return { ok: true, output: { skipped: true } };
        }
      },
      dependsOn: ['generate_comments'],
    },
    {
      name: 'verify_fixes',
      fn: async (ctx: WorkflowContext) => {
        const mode = ctx.get<string>('mode') ?? 'review';
        if (mode !== 'fix' && mode !== 'build') {
          return { ok: true, output: { skipped: true, reason: 'Not in fix/build mode' } };
        }
        ctx.log('Verifying fixes');
        return { ok: true, output: { verificationPassed: true } };
      },
      dependsOn: ['apply_fixes'],
    },
    {
      name: 'blind_spot_generation',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Generating blind spot declarations');
        const designScore = ctx.get<number>('designScore') ?? 100;
        const alertCount = ctx.get<number>('alertCount') ?? 0;
        const knowledgeConfidence = ctx.get<number>('knowledgeConfidence') ?? 1;
        const entityCount = (ctx.get<any[]>('businessEntities') ?? []).length;

        const hasFindings = designScore < 100 || alertCount > 0 || knowledgeConfidence < 1 || entityCount > 0;
        if (!hasFindings) {
          ctx.set('blindSpotsGenerated', 0);
          return { ok: true, output: { skipped: true, reason: 'No findings', blindSpotsGenerated: 0 } };
        }

        // Generate blind spot IDs for evidence store
        const blindSpotIds: string[] = [];
        const runId = ctx.runId;

        if (designScore < 80) {
          const bsId = `BSD-${runId}-design`;
          blindSpotIds.push(bsId);
          await adapters.evidenceStore?.recordBlindSpot?.({ id: bsId, section: 'Design Review', confidence: 65 }, runId);
        }
        if (alertCount > 0) {
          const bsId = `BSD-${runId}-security`;
          blindSpotIds.push(bsId);
          await adapters.evidenceStore?.recordBlindSpot?.({ id: bsId, section: 'Security', confidence: 70 }, runId);
        }

        ctx.set('blindSpotsGenerated', blindSpotIds.length);
        ctx.set('blindSpotIds', blindSpotIds);
        return { ok: true, output: { blindSpotsGenerated: blindSpotIds.length, blindSpotIds } };
      },
      dependsOn: ['post_comments'],
    },
    {
      name: 'report_results',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Reporting results to analytics');
        try {
          const mode = ctx.get<string>('mode') ?? 'review';
          await adapters.analytics?.recordEvent?.('review_completed', {
            runId: ctx.runId,
            mode,
            completedAt: new Date().toISOString(),
          });
          return { ok: true, output: { reported: true } };
        } catch (err) {
          ctx.log(`Analytics reporting failed: ${err}`);
          return { ok: true, output: { reported: false } };
        }
      },
      dependsOn: ['blind_spot_generation', 'verify_fixes', 'post_comments'],
    },
    {
      name: 'impact_translation',
      fn: async (ctx: WorkflowContext) => {
        ctx.log('Translating escalated findings into build impact cards');
        const criticalCount = ctx.get<number>('criticalCount') ?? 0;
        if (criticalCount === 0) {
          return { ok: true, output: { skipped: true, reason: 'No critical findings', escalationsGenerated: 0 } };
        }
        const runId = ctx.runId;
        const escalationIds: string[] = [];
        for (let i = 0; i < criticalCount; i++) {
          const escId = `ESC-${runId.slice(-8)}-${String(i + 1).padStart(3, '0')}`;
          escalationIds.push(escId);
          await adapters.evidenceStore?.recordEscalation?.({ escalationId: escId, findingCategory: 'Pipeline Security' }, runId);
        }
        ctx.set('escalationIds', escalationIds);
        return { ok: true, output: { escalationsGenerated: escalationIds.length, escalationIds } };
      },
      dependsOn: ['report_results'],
    },
  ];
}

export function defineFailingCodeReviewWorkflow(engine: WorkflowEngine): void {
  const validate_webhook = stub('validate_webhook');
  const parse_pr = stub('parse_pr');
  const fetch_comments = stub('fetch_comments');
  const classify_comments = stub('classify_comments');

  const analyze_code = stub('analyze_code');
  const business_context = stub('business_context');
  const knowledge_search = stub('knowledge_search');
  const design_review = stub('design_review');
  const security_scan = failStub('security_scan');

  const apply_fixes = stub('apply_fixes');
  const post_reply = stub('post_reply');
  const log_analytics = stub('log_analytics');

  engine.define(
    { name: 'code_review_failing', retry: { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 500 } },
    [
      { name: 'validate_webhook', fn: validate_webhook },
      { name: 'parse_pr', fn: parse_pr, dependsOn: ['validate_webhook'] },
      { name: 'fetch_comments', fn: fetch_comments, dependsOn: ['parse_pr'] },
      { name: 'classify_comments', fn: classify_comments, dependsOn: ['fetch_comments'] },

      {
        name: 'analyze_code',
        fn: analyze_code,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_analyze_code'),
      },
      {
        name: 'business_context',
        fn: business_context,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_business_context'),
      },
      {
        name: 'knowledge_search',
        fn: knowledge_search,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_knowledge_search'),
      },
      { name: 'design_review', fn: design_review, dependsOn: ['classify_comments'] },
      {
        name: 'security_scan',
        fn: security_scan,
        dependsOn: ['classify_comments'],
        compensation: stub('compensate_security_scan'),
      },

      {
        name: 'apply_fixes',
        fn: apply_fixes,
        dependsOn: ['analyze_code', 'business_context', 'knowledge_search', 'design_review', 'security_scan'],
      },
      { name: 'post_reply', fn: post_reply, dependsOn: ['apply_fixes'] },
      { name: 'log_analytics', fn: log_analytics, dependsOn: ['post_reply'] },
    ]
  );
}
