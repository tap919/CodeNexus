'use client';

interface PipelineStep {
  id: string;
  label: string;
  status: 'complete' | 'active' | 'pending' | 'failed';
  duration?: string;
  detail?: string;
}

const defaultSteps: PipelineStep[] = [
  { id: 'ingest', label: 'Ingest', status: 'complete', duration: '1.2s', detail: 'PR #142 · auth-service' },
  { id: 'clone', label: 'Clone', status: 'complete', duration: '3.8s', detail: '14 MB · 420 files' },
  { id: 'analyze', label: 'Analyze', status: 'active', duration: '12.5s', detail: 'AST · Dependency graph' },
  { id: 'scan', label: 'Security Scan', status: 'pending', detail: 'Semgrep · Gitleaks · SAST' },
  { id: 'review', label: 'AI Review', status: 'pending', detail: 'GPT-4o · 3 passes' },
  { id: 'verify', label: 'Verify', status: 'pending', detail: 'Test · Lint · Build' },
  { id: 'fix', label: 'Apply Fixes', status: 'pending', detail: 'Auto-fix · CI check' },
  { id: 'report', label: 'Report', status: 'pending', detail: 'PR comment · Dashboard' },
];

function StepDot({ step }: { step: PipelineStep }) {
  const colorMap = {
    complete: 'complete',
    active: 'active',
    pending: '',
    failed: 'active',
  } as const;

  return (
    <div className="flex flex-col items-center">
      <div className={`connector-dot ${colorMap[step.status]}`}>
        {step.status === 'active' && (
          <div className="absolute inset-0 rounded-full" style={{ animation: 'ripple 1.5s ease-out infinite' }} />
        )}
      </div>
    </div>
  );
}

function StepCard({ step, index }: { step: PipelineStep; index: number }) {
  const isActive = step.status === 'active';
  const delay = `${index * 50}ms`;

  return (
    <div
      className={`
        relative flex items-center gap-4 px-4 py-3 glass-panel glass-panel-hover animate-slide-up
        ${isActive ? 'glow-blue border-accent-blue/20' : ''}
      `}
      style={{ animationDelay: delay }}
    >
      <StepDot step={step} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>
            {step.label}
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-[10px] text-accent-blue">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
              Running
            </span>
          )}
        </div>
        {step.detail && (
          <p className="text-[11px] text-text-muted mt-0.5 truncate">{step.detail}</p>
        )}
      </div>
      {step.duration && (
        <span className={`text-xs font-mono ${isActive ? 'text-accent-blue' : 'text-text-muted'}`}>
          {step.duration}
        </span>
      )}
      {step.status === 'complete' && (
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-green/15 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )}
    </div>
  );
}

export function Pipeline() {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Pipeline</h2>
        <span className="tag-cyan text-[10px]">3 min avg</span>
      </div>

      {/* Horizontal connector line */}
      <div className="relative pl-4">
        <div className="absolute left-[31px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-accent-green/50 via-accent-blue/50 to-base-700" />

        <div className="space-y-1.5">
          {defaultSteps.map((step, i) => (
            <StepCard key={step.id} step={step} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
