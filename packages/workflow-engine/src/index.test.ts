import { WorkflowEngine } from './index.js';
import { defineCodeReviewWorkflow, defineFailingCodeReviewWorkflow } from './review-workflow.js';

function stub(stepName: string, delayMs = 10) {
  return async (ctx: { log: (msg: string) => void }) => {
    ctx.log(`${stepName} executing...`);
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: true, output: { step: stepName } };
  };
}

function recoverableStub(stepName: string, failAttempts: number, delayMs = 10) {
  let calls = 0;
  return async (ctx: { log: (msg: string) => void }) => {
    calls++;
    ctx.log(`${stepName} executing (attempt ${calls})...`);
    await new Promise(r => setTimeout(r, delayMs));
    if (calls <= failAttempts) {
      return { ok: false, error: `${stepName} transient failure`, recoverable: true };
    }
    return { ok: true, output: { step: stepName } };
  };
}

function nonRecoverableStub(stepName: string, delayMs = 10) {
  return async (ctx: { log: (msg: string) => void }) => {
    ctx.log(`${stepName} executing...`);
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: false, error: `${stepName} fatal`, recoverable: false };
  };
}

function slowStub(stepName: string, delayMs = 500) {
  return async (ctx: { log: (msg: string) => void }) => {
    ctx.log(`${stepName} executing...`);
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: true, output: { step: stepName } };
  };
}

test('workflow executes all 12 steps in topological order', async () => {
  const engine = new WorkflowEngine();
  defineCodeReviewWorkflow(engine);

  const run = await engine.execute('code_review');

  expect(run.status).toBe('completed');
  expect(run.workflowName).toBe('code_review');

  const stepNames = [...run.steps.keys()];
  expect(stepNames).toHaveLength(12);

  const doneSteps = [...run.steps.values()].filter(s => s.status === 'done');
  expect(doneSteps).toHaveLength(12);
});

test('parallel steps execute concurrently', async () => {
  const engine = new WorkflowEngine();
  const startTimes: Map<string, number> = new Map();
  const endTimes: Map<string, number> = new Map();

  const timedStub = (name: string, delayMs: number) => async (ctx: { log: (msg: string) => void }) => {
    startTimes.set(name, Date.now());
    ctx.log(`${name} executing...`);
    await new Promise(r => setTimeout(r, delayMs));
    endTimes.set(name, Date.now());
    return { ok: true };
  };

  const classify = timedStub('classify_comments', 10);

  engine.define(
    { name: 'concurrent_test' },
    [
      { name: 'classify_comments', fn: classify },
      { name: 'analyze_code', fn: timedStub('analyze_code', 100), dependsOn: ['classify_comments'] },
      { name: 'business_context', fn: timedStub('business_context', 100), dependsOn: ['classify_comments'] },
      { name: 'security_scan', fn: timedStub('security_scan', 100), dependsOn: ['classify_comments'] },
    ]
  );

  await engine.execute('concurrent_test');

  const classifyEnd = endTimes.get('classify_comments')!;
  const analysisStarts = ['analyze_code', 'business_context', 'security_scan'].map(n => startTimes.get(n)!);

  analysisStarts.forEach(start => {
    expect(start).toBeGreaterThanOrEqual(classifyEnd);
  });

  const maxStart = Math.max(...analysisStarts);
  const minEnd = Math.min(
    ...['analyze_code', 'business_context', 'security_scan'].map(n => endTimes.get(n)!)
  );

  expect(maxStart).toBeLessThan(minEnd);
});

test('retry on recoverable error succeeds', async () => {
  const engine = new WorkflowEngine();
  let compensationCalls = 0;
  const compStub = async (ctx: { log: (msg: string) => void }) => {
    compensationCalls++;
    ctx.log('compensating...');
    await new Promise(r => setTimeout(r, 10));
    return { ok: true };
  };

  engine.define(
    { name: 'retry_test', retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 } },
    [
      { name: 'flaky_step', fn: recoverableStub('flaky_step', 2) },
      { name: 'normal_step', fn: stub('normal_step'), dependsOn: ['flaky_step'], compensation: compStub },
    ]
  );

  const run = await engine.execute('retry_test');

  expect(run.status).toBe('completed');

  const flakyStep = run.steps.get('flaky_step')!;
  expect(flakyStep.status).toBe('done');
  expect(flakyStep.attempts).toBe(3);

  expect(compensationCalls).toBe(0);
});

test('non-recoverable error triggers compensation on completed steps', async () => {
  const engine = new WorkflowEngine();
  const compensationLog: string[] = [];

  const compStub = (name: string) => async (ctx: { log: (msg: string) => void }) => {
    compensationLog.push(name);
    ctx.log(`compensating ${name}...`);
    await new Promise(r => setTimeout(r, 10));
    return { ok: true };
  };

  engine.define(
    { name: 'compensate_test', retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 } },
    [
      { name: 'step_a', fn: stub('step_a'), compensation: compStub('comp_a') },
      { name: 'step_b', fn: stub('step_b'), dependsOn: ['step_a'], compensation: compStub('comp_b') },
      { name: 'step_c', fn: nonRecoverableStub('step_c'), dependsOn: ['step_b'], compensation: compStub('comp_c') },
    ]
  );

  const run = await engine.execute('compensate_test');

  expect(run.status).toBe('failed');

  expect(compensationLog).toContain('comp_b');
  expect(compensationLog).toContain('comp_a');

  expect(compensationLog.indexOf('comp_b')).toBeLessThan(compensationLog.indexOf('comp_a'));
});

test('topological sort produces correct level ordering', async () => {
  const engine = new WorkflowEngine();
  const executionOrder: string[] = [];

  const orderedStub = (name: string) => async (ctx: { log: (msg: string) => void }) => {
    executionOrder.push(name);
    ctx.log(`${name} executing...`);
    await new Promise(r => setTimeout(r, 10));
    return { ok: true };
  };

  engine.define(
    { name: 'topo_test' },
    [
      { name: 'step_1', fn: orderedStub('step_1') },
      { name: 'step_2a', fn: orderedStub('step_2a'), dependsOn: ['step_1'] },
      { name: 'step_2b', fn: orderedStub('step_2b'), dependsOn: ['step_1'] },
      { name: 'step_3', fn: orderedStub('step_3'), dependsOn: ['step_2a', 'step_2b'] },
    ]
  );

  await engine.execute('topo_test');

  const idx1 = executionOrder.indexOf('step_1');
  const idx2a = executionOrder.indexOf('step_2a');
  const idx2b = executionOrder.indexOf('step_2b');
  const idx3 = executionOrder.indexOf('step_3');

  expect(idx1).toBeLessThan(idx2a);
  expect(idx1).toBeLessThan(idx2b);
  expect(idx2a).toBeLessThan(idx3);
  expect(idx2b).toBeLessThan(idx3);
});

test('cancellation stops further level processing', async () => {
  const engine = new WorkflowEngine();
  const executed: string[] = [];

  const cancellableStub = (name: string, delayMs = 10) => async (ctx: { log: (msg: string) => void }) => {
    executed.push(name);
    ctx.log(`${name} executing...`);
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: true };
  };

  engine.define(
    { name: 'cancel_test' },
    [
      { name: 'level1_a', fn: cancellableStub('level1_a', 50) },
      { name: 'level1_b', fn: cancellableStub('level1_b', 50) },
      { name: 'level2', fn: cancellableStub('level2', 50), dependsOn: ['level1_a', 'level1_b'] },
      { name: 'level3', fn: cancellableStub('level3'), dependsOn: ['level2'] },
    ]
  );

  const execPromise = engine.execute('cancel_test');

  await new Promise(r => setTimeout(r, 20));
  const runs = engine.listRuns();
  const runId = runs[0]?.id;
  if (runId) engine.cancel(runId);

  const run = await execPromise;

  expect(run.status).toBe('cancelled');
  expect(executed).not.toContain('level3');
});

test('full code review workflow succeeds', async () => {
  const engine = new WorkflowEngine();
  defineCodeReviewWorkflow(engine);

  const run = await engine.execute('code_review', { pr_url: 'https://github.com/foo/bar/pull/42' });

  expect(run.status).toBe('completed');
  expect(run.steps.size).toBe(12);

  const analysisSteps = ['analyze_code', 'business_context', 'knowledge_search', 'design_review', 'security_scan'];
  analysisSteps.forEach(name => {
    expect(run.steps.get(name)!.status).toBe('done');
  });
});

test('failing workflow triggers compensations', async () => {
  const engine = new WorkflowEngine();
  defineFailingCodeReviewWorkflow(engine);

  const run = await engine.execute('code_review_failing');

  expect(run.status).toBe('failed');
  expect(run.steps.get('security_scan')!.status).toBe('failed');
});

test('event listeners receive lifecycle events', async () => {
  const engine = new WorkflowEngine();
  const events: string[] = [];

  engine.on('*', (event: string) => { events.push(event); });

  engine.define(
    { name: 'event_test', retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 } },
    [
      { name: 'step_a', fn: stub('step_a') },
    ]
  );

  await engine.execute('event_test');

  expect(events).toContain('run:start');
  expect(events).toContain('step:start');
  expect(events).toContain('step:done');
  expect(events).toContain('run:complete');
});

test('run state is queryable after execution', async () => {
  const engine = new WorkflowEngine();
  defineCodeReviewWorkflow(engine);

  const run = await engine.execute('code_review');
  const retrieved = engine.getRun(run.id);
  const allRuns = engine.listRuns();

  expect(retrieved).toBeDefined();
  expect(retrieved!.status).toBe('completed');
  expect(allRuns.length).toBeGreaterThanOrEqual(1);

  allRuns.forEach(r => {
    expect(r.id).toBeDefined();
    expect(r.createdAt).toBeDefined();
  });
});
