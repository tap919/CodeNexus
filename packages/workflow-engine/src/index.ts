type StepFn = (ctx: WorkflowContext) => Promise<StepResult>;

interface WorkflowConfig {
  name: string;
  retry?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  concurrency?: number;
}

interface WorkflowStep {
  name: string;
  fn: StepFn;
  dependsOn?: string[];
  timeoutMs?: number;
  compensation?: StepFn;
}

interface WorkflowContext {
  runId: string;
  state: Map<string, unknown>;
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  log(msg: string): void;
}

interface StepResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  recoverable?: boolean;
}

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'compensated';
type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface RunState {
  id: string;
  workflowName: string;
  status: RunStatus;
  steps: Map<string, { status: StepStatus; attempts: number; error?: string; startedAt?: string; doneAt?: string }>;
  events: { ts: string; event: string; detail?: string }[];
  createdAt: string;
}

export class WorkflowEngine {
  private workflows = new Map<string, { config: WorkflowConfig; steps: WorkflowStep[] }>();
  private runs = new Map<string, RunState>();
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private active = 0;
  private maxConcurrent = 10;

  define(config: WorkflowConfig, steps: WorkflowStep[]): void {
    this.workflows.set(config.name, { config, steps });
  }

  async execute(name: string, input?: Record<string, unknown>): Promise<RunState> {
    const wf = this.workflows.get(name);
    if (!wf) throw new Error(`Workflow "${name}" not found`);

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = new Map<string, unknown>();
    if (input) Object.entries(input).forEach(([k, v]) => state.set(k, v));

    const ctx: WorkflowContext = {
      runId,
      state,
      get: <T>(k: string) => state.get(k) as T,
      set: (k, v) => state.set(k, v),
      log: (msg) => this.emit('log', { runId, msg }),
    };

    const run: RunState = {
      id: runId,
      workflowName: name,
      status: 'running',
      steps: new Map(),
      events: [],
      createdAt: new Date().toISOString(),
    };

    wf.steps.forEach(s => run.steps.set(s.name, { status: 'pending', attempts: 0 }));
    this.runs.set(runId, run);
    this.emit('run:start', { runId, workflowName: name });

    try {
      const levels = this.topologicalLevels(wf.steps);
      const accounted = levels.flat();
      if (accounted.length !== wf.steps.length) {
        throw new Error(`Workflow "${name}" contains circular dependencies: ${wf.steps.length} steps defined, ${accounted.length} reachable`);
      }
      for (const level of levels) {
        if (run.status === 'cancelled') break;
        const results = await Promise.allSettled(
          level.map(step => this.executeStep(step, run, ctx, wf))
        );
        const anyFailed = results.some(r => r.status === 'rejected');
        if (anyFailed) throw new Error('Step level failed');
      }
      if (run.status === 'cancelled') {
        run.status = 'cancelled';
        this.emit('run:cancelled', { runId });
        return run;
      }
      run.status = 'completed';
      this.emit('run:complete', { runId });
    } catch (err) {
      await this.runCompensations(wf.steps, run, ctx);
      run.status = run.status === 'cancelled' ? 'cancelled' : 'failed';
      this.emit('run:fail', { runId, error: (err as Error).message });
    }

    return run;
  }

  private async executeStep(
    step: WorkflowStep,
    run: RunState,
    ctx: WorkflowContext,
    wf: { config: WorkflowConfig; steps: WorkflowStep[] }
  ): Promise<void> {
    const stepState = run.steps.get(step.name)!;
    const retry = wf.config.retry || { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 };

    stepState.status = 'running';
    stepState.startedAt = new Date().toISOString();
    this.emit('step:start', { runId: run.id, step: step.name });

    for (let attempt = 1; attempt <= retry.maxRetries + 1; attempt++) {
      stepState.attempts = attempt;
      try {
        const result = await Promise.race([
          step.fn(ctx),
          step.timeoutMs ? new Promise<StepResult>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), step.timeoutMs)
          ) : null as any,
        ].filter(Boolean));

        if (result.ok) {
          stepState.status = 'done';
          stepState.doneAt = new Date().toISOString();
          this.emit('step:done', { runId: run.id, step: step.name });
          return;
        }

        if (!result.recoverable) throw new Error(result.error || 'Non-recoverable error');
        if (attempt > retry.maxRetries) throw new Error(`Max retries (${retry.maxRetries}) exceeded`);

        const delay = Math.min(retry.baseDelayMs * Math.pow(2, attempt - 1), retry.maxDelayMs);
        await new Promise(r => setTimeout(r, delay));
        this.emit('step:retry', { runId: run.id, step: step.name, attempt });
      } catch (err) {
        if (attempt > retry.maxRetries) {
          stepState.status = 'failed';
          stepState.error = (err as Error).message;
          this.emit('step:fail', { runId: run.id, step: step.name, error: stepState.error });
          throw err;
        }
        const delay = Math.min(retry.baseDelayMs * Math.pow(2, attempt - 1), retry.maxDelayMs);
        await new Promise(r => setTimeout(r, delay));
        this.emit('step:retry', { runId: run.id, step: step.name, attempt });
      }
    }
  }

  private async runCompensations(steps: WorkflowStep[], run: RunState, ctx: WorkflowContext): Promise<void> {
    const completed = steps.filter(s => run.steps.get(s.name)?.status === 'done' && s.compensation);
    for (const step of completed.reverse()) {
      try {
        run.steps.get(step.name)!.status = 'compensated';
        this.emit('step:compensate', { runId: run.id, step: step.name });
        await step.compensation!(ctx);
      } catch (err) {
        this.emit('step:compensate-fail', { runId: run.id, step: step.name, error: (err as Error).message });
      }
    }
  }

  private topologicalLevels(steps: WorkflowStep[]): WorkflowStep[][] {
    const inDegree = new Map<string, number>();
    const children = new Map<string, WorkflowStep[]>();
    steps.forEach(s => { inDegree.set(s.name, s.dependsOn?.length || 0); children.set(s.name, []); });
    steps.forEach(s => s.dependsOn?.forEach(d => children.get(d)?.push(s)));

    const levels: WorkflowStep[][] = [];
    let queue = steps.filter(s => inDegree.get(s.name) === 0);

    while (queue.length) {
      levels.push(queue);
      const next: WorkflowStep[] = [];
      for (const s of queue) {
        for (const child of children.get(s.name) || []) {
          const deg = inDegree.get(child.name)! - 1;
          inDegree.set(child.name, deg);
          if (deg === 0) next.push(child);
        }
      }
      queue = next;
    }
    return levels;
  }

  cancel(runId: string): void { const r = this.runs.get(runId); if (r) r.status = 'cancelled'; }
  getRun(runId: string) { return this.runs.get(runId); }
  listRuns() { return [...this.runs.values()]; }

  on(event: string, handler: (...args: any[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(h => { try { h(data); } catch {} });
    this.listeners.get('*')?.forEach(h => { try { h(event, data); } catch {} });
  }
}
