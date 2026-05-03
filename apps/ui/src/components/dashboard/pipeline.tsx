'use client';

interface PipelineStep {
  id: string;
  label: string;
  status: 'complete' | 'active' | 'pending' | 'failed';
  duration?: string;
  detail?: string;
  icon: string;
}

const defaultSteps: PipelineStep[] = [
  { id: 'ingest', label: 'Ingest', icon: '⬇', status: 'complete', duration: '1.2s', detail: 'PR #142 · auth-service' },
  { id: 'clone', label: 'Clone', icon: '⎘', status: 'complete', duration: '3.8s', detail: '14 MB · 420 files' },
  { id: 'analyze', label: 'Analyze', icon: '⬡', status: 'active', duration: '12.5s', detail: 'AST · Dependency graph' },
  { id: 'scan', label: 'Security', icon: '⚿', status: 'pending', detail: 'Semgrep · Gitleaks · SAST' },
  { id: 'review', label: 'AI Review', icon: '◎', status: 'pending', detail: 'GPT-4o · 3 passes' },
  { id: 'verify', label: 'Verify', icon: '✓', status: 'pending', detail: 'Test · Lint · Build' },
  { id: 'fix', label: 'Apply Fixes', icon: '⚡', status: 'pending', detail: 'Auto-fix · CI check' },
  { id: 'report', label: 'Report', icon: '◈', status: 'pending', detail: 'PR comment · Dashboard' },
];

const statusStyles = {
  complete: { dot: 'bg-accent-green border-accent-green shadow-[0_0_8px_rgba(74,222,128,0.4)]', text: 'text-text-secondary', badge: 'tag tag-green' },
  active: { dot: 'bg-accent-blue border-accent-blue shadow-[0_0_12px_rgba(77,171,247,0.5)]', text: 'text-text-primary', badge: 'tag tag-blue' },
  pending: { dot: 'bg-base-700 border-base-600', text: 'text-text-muted', badge: '' },
  failed: { dot: 'bg-accent-red border-accent-red shadow-[0_0_8px_rgba(248,113,113,0.4)]', text: 'text-accent-red', badge: 'tag tag-red' },
};

function StepRow({ step, index }: { step: PipelineStep; index: number }) {
  const style = statusStyles[step.status];
  const isActive = step.status === 'active';

  return (
    <div
      className={`flex items-center gap-4 p-3 rounded-xl transition-all ${
        isActive ? 'bg-accent-blue/5 border border-accent-blue/15' : 'hover:bg-base-800/40'
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Step number + dot */}
      <div className="relative flex-shrink-0">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-mono transition-all ${style.dot}`}>
          {step.status === 'complete' ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="#0a0a0f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : step.status === 'active' ? (
            <div className="w-2 h-2 rounded-full bg-white" style={{ animation: 'ripple 1.5s ease-out infinite' }} />
          ) : step.status === 'failed' ? (
            <span className="text-white">✕</span>
          ) : (
            <span className="text-base-500 text-xs">{String(index + 1).padStart(2, '0')}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-sm font-semibold ${style.text}`}>{step.label}</span>
          {isActive && <span className="tag tag-blue text-[10px]">Running</span>}
          {step.status === 'complete' && <span className="tag tag-green text-[10px]">Done</span>}
        </div>
        {step.detail && (
          <p className="text-xs text-text-muted truncate">{step.detail}</p>
        )}
      </div>

      {/* Duration */}
      {step.duration && (
        <span className="text-xs font-mono text-text-muted flex-shrink-0">{step.duration}</span>
      )}
    </div>
  );
}

export function Pipeline() {
  const completedCount = defaultSteps.filter(s => s.status === 'complete').length;
  const totalCount = defaultSteps.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="skeuo-card p-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Review Pipeline</h3>
          <p className="text-xs text-text-muted mt-0.5">{completedCount} of {totalCount} steps complete</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-dot online" />
          <span className="text-xs text-text-muted">Live</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress-bar mb-5">
        <div
          className="progress-bar-fill pipeline-line"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {defaultSteps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} />
        ))}
      </div>
    </div>
  );
}
