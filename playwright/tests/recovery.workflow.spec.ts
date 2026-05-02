import { test, expect } from '@playwright/test';
import { WorkflowEngine } from '../../packages/workflow-engine/src/index';

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
    return { ok: false, error: `${stepName} fatal error`, recoverable: false };
  };
}

test.describe('Workflow Engine', () => {
  test('defines and executes a simple workflow with all steps in order', async () => {
    const engine = new WorkflowEngine();
    const executionOrder: string[] = [];

    const orderedStub = (name: string) => async (ctx: { log: (msg: string) => void }) => {
      executionOrder.push(name);
      ctx.log(`${name} executing...`);
      await new Promise(r => setTimeout(r, 10));
      return { ok: true, output: { step: name } };
    };

    engine.define(
      { name: 'simple_test' },
      [
        { name: 'step_1', fn: orderedStub('step_1') },
        { name: 'step_2', fn: orderedStub('step_2'), dependsOn: ['step_1'] },
        { name: 'step_3', fn: orderedStub('step_3'), dependsOn: ['step_2'] },
      ],
    );

    const run = await engine.execute('simple_test');

    expect(run.status).toBe('completed');
    expect(run.steps.size).toBe(3);

    for (const stepName of ['step_1', 'step_2', 'step_3']) {
      expect(run.steps.get(stepName)!.status).toBe('done');
    }

    expect(executionOrder.indexOf('step_1')).toBeLessThan(executionOrder.indexOf('step_2'));
    expect(executionOrder.indexOf('step_2')).toBeLessThan(executionOrder.indexOf('step_3'));
  });

  test('handles cancellation gracefully', async () => {
    const engine = new WorkflowEngine();
    const executed: string[] = [];

    const slowStub = (name: string, delayMs: number) => async (ctx: { log: (msg: string) => void }) => {
      executed.push(name);
      ctx.log(`${name} executing...`);
      await new Promise(r => setTimeout(r, delayMs));
      return { ok: true, output: { step: name } };
    };

    engine.define(
      { name: 'cancel_test' },
      [
        { name: 'level1_a', fn: slowStub('level1_a', 50) },
        { name: 'level1_b', fn: slowStub('level1_b', 50) },
        { name: 'level2', fn: slowStub('level2', 50), dependsOn: ['level1_a', 'level1_b'] },
        { name: 'level3', fn: slowStub('level3', 10), dependsOn: ['level2'] },
      ],
    );

    const execPromise = engine.execute('cancel_test');

    await new Promise(r => setTimeout(r, 30));
    const runs = engine.listRuns();
    const runId = runs[0]?.id;
    if (runId) engine.cancel(runId);

    const run = await execPromise;

    expect(run.status).toBe('cancelled');
    expect(executed).not.toContain('level3');

    const retrieved = engine.getRun(run.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.status).toBe('cancelled');
  });

  test('compensation runs on failure of a downstream step', async () => {
    const engine = new WorkflowEngine();
    const compensationLog: string[] = [];

    const compStub = (name: string) => async (ctx: { log: (msg: string) => void }) => {
      compensationLog.push(name);
      ctx.log(`compensating ${name}...`);
      await new Promise(r => setTimeout(r, 10));
      return { ok: true };
    };

    engine.define(
      { name: 'compensate_test', retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 50 } },
      [
        { name: 'step_a', fn: stub('step_a'), compensation: compStub('comp_a') },
        { name: 'step_b', fn: stub('step_b'), dependsOn: ['step_a'], compensation: compStub('comp_b') },
        { name: 'step_c', fn: nonRecoverableStub('step_c'), dependsOn: ['step_b'] },
        { name: 'step_d', fn: stub('step_d'), dependsOn: ['step_c'] },
      ],
    );

    const run = await engine.execute('compensate_test');

    expect(run.status).toBe('failed');

    expect(compensationLog).toContain('comp_b');
    expect(compensationLog).toContain('comp_a');
    expect(compensationLog.indexOf('comp_b')).toBeLessThan(compensationLog.indexOf('comp_a'));

    expect(run.steps.get('step_c')!.status).toBe('failed');
    expect(run.steps.get('step_d')!.status).toBe('pending');
  });

  test('retry with recoverable errors eventually succeeds', async () => {
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
        { name: 'final_step', fn: stub('final_step'), dependsOn: ['normal_step'] },
      ],
    );

    const run = await engine.execute('retry_test');

    expect(run.status).toBe('completed');

    const flakyStep = run.steps.get('flaky_step')!;
    expect(flakyStep.status).toBe('done');
    expect(flakyStep.attempts).toBe(3);

    expect(run.steps.get('normal_step')!.status).toBe('done');
    expect(run.steps.get('final_step')!.status).toBe('done');
    expect(compensationCalls).toBe(0);
  });

  test('retry exhausts and fails with non-recoverable error', async () => {
    const engine = new WorkflowEngine();

    engine.define(
      { name: 'exhaust_test', retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 } },
      [
        { name: 'step_a', fn: stub('step_a') },
        { name: 'step_b', fn: nonRecoverableStub('step_b'), dependsOn: ['step_a'] },
      ],
    );

    const run = await engine.execute('exhaust_test');

    expect(run.status).toBe('failed');
    expect(run.steps.get('step_b')!.status).toBe('failed');
    expect(run.steps.get('step_b')!.attempts).toBeGreaterThanOrEqual(1);
  });

  test('workflow with input passes context to steps', async () => {
    const engine = new WorkflowEngine();
    let capturedPrUrl = '';

    const contextReader = async (ctx: { get: <T>(key: string) => T; log: (msg: string) => void }) => {
      capturedPrUrl = ctx.get<string>('pr_url') || '';
      ctx.log(`received pr_url: ${capturedPrUrl}`);
      await new Promise(r => setTimeout(r, 10));
      return { ok: true };
    };

    engine.define(
      { name: 'context_test' },
      [
        { name: 'read_input', fn: contextReader },
      ],
    );

    const run = await engine.execute('context_test', { pr_url: 'https://github.com/org/repo/pull/42' });

    expect(run.status).toBe('completed');
    expect(capturedPrUrl).toBe('https://github.com/org/repo/pull/42');
  });

  test('event system emits lifecycle events', async () => {
    const engine = new WorkflowEngine();
    const events: string[] = [];

    engine.on('*', (event: string) => {
      events.push(event);
    });

    engine.define(
      { name: 'event_test', retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 } },
      [
        { name: 'step_a', fn: stub('step_a') },
        { name: 'step_b', fn: stub('step_b'), dependsOn: ['step_a'] },
      ],
    );

    await engine.execute('event_test');

    expect(events).toContain('run:start');
    expect(events).toContain('step:start');
    expect(events).toContain('step:done');
    expect(events).toContain('run:complete');
  });

  test('parallel steps execute in same level concurrently', async () => {
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

    engine.define(
      { name: 'concurrent_test' },
      [
        { name: 'classify', fn: timedStub('classify', 10) },
        { name: 'analyze', fn: timedStub('analyze', 80), dependsOn: ['classify'] },
        { name: 'business', fn: timedStub('business', 80), dependsOn: ['classify'] },
        { name: 'security', fn: timedStub('security', 80), dependsOn: ['classify'] },
      ],
    );

    await engine.execute('concurrent_test');

    const classifyEnd = endTimes.get('classify')!;
    const analysisStarts = ['analyze', 'business', 'security'].map(n => startTimes.get(n)!);

    analysisStarts.forEach(start => {
      expect(start).toBeGreaterThanOrEqual(classifyEnd);
    });

    const maxStart = Math.max(...analysisStarts);
    const minEnd = Math.min(
      ...['analyze', 'business', 'security'].map(n => endTimes.get(n)!),
    );

    expect(maxStart).toBeLessThan(minEnd);
  });

  test('non-existent workflow throws error', async () => {
    const engine = new WorkflowEngine();

    await expect(engine.execute('nonexistent')).rejects.toThrow('Workflow "nonexistent" not found');
  });

  test('list runs returns all tracked workflows', async () => {
    const engine = new WorkflowEngine();

    engine.define({ name: 'wf_a' }, [{ name: 'step_a', fn: stub('step_a') }]);
    engine.define({ name: 'wf_b' }, [{ name: 'step_b', fn: stub('step_b') }]);

    await engine.execute('wf_a');
    await engine.execute('wf_b');

    const runs = engine.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(2);

    runs.forEach(r => {
      expect(r.id).toBeDefined();
      expect(r.workflowName).toBeDefined();
      expect(r.createdAt).toBeDefined();
      expect(['completed', 'failed', 'running', 'cancelled']).toContain(r.status);
    });
  });
});
