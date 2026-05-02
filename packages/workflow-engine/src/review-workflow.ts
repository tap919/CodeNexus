import { WorkflowEngine } from './index.js';

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
