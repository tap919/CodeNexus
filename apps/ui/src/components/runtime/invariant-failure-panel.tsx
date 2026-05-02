'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, ExternalLink } from 'lucide-react';

interface InvariantFailurePanelProps {
  invariantName: string;
  expectedState: string;
  actualState: string;
  failurePoint: string;
  affectedSubsystem: string;
  linkedFindingId?: string;
  severity: 'critical' | 'high' | 'medium';
}

const severityStyles: Record<string, { badge: string; border: string; text: string }> = {
  critical: {
    badge: 'bg-intent-critical/15 text-intent-critical border-intent-critical/30',
    border: 'border-l-intent-critical',
    text: 'text-intent-critical',
  },
  high: {
    badge: 'bg-intent-warning/15 text-intent-warning border-intent-warning/30',
    border: 'border-l-intent-warning',
    text: 'text-intent-warning',
  },
  medium: {
    badge: 'bg-fg-muted/15 text-fg-muted border-fg-muted/20',
    border: 'border-l-fg-muted',
    text: 'text-fg-muted',
  },
};

export function InvariantFailurePanel({
  invariantName,
  expectedState,
  actualState,
  failurePoint,
  affectedSubsystem,
  linkedFindingId,
  severity,
}: InvariantFailurePanelProps) {
  const s = severityStyles[severity];

  return (
    <div className={cn('p-3 rounded-xl bg-surface border border-border-subtle border-l-2', s.border)}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className={cn('w-4 h-4', s.text)} />
        <h3 className="text-sm font-medium text-fg-primary truncate">{invariantName}</h3>
        <span
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0',
            s.badge
          )}
        >
          {severity}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-intent-success/5 border border-intent-success/20">
          <span className="text-[10px] text-intent-success uppercase tracking-wider">Expected</span>
          <p className="text-xs text-fg-primary mt-1 line-clamp-3">{expectedState}</p>
        </div>
        <div className="p-2 rounded-lg bg-intent-critical/5 border border-intent-critical/20">
          <span className="text-[10px] text-intent-critical uppercase tracking-wider">Actual</span>
          <p className="text-xs text-fg-primary mt-1 line-clamp-3">{actualState}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 mt-2">
        <div className="flex-1 grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-fg-disabled uppercase">Failure Point</span>
            <p className="text-[11px] text-fg-primary font-mono">{failurePoint}</p>
          </div>
          <div>
            <span className="text-[10px] text-fg-disabled uppercase">Affected Subsystem</span>
            <p className="text-[11px] text-fg-primary">{affectedSubsystem}</p>
          </div>
        </div>
        {linkedFindingId && (
          <a
            href="#"
            className={cn(
              'flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors shrink-0',
              s.badge
            )}
          >
            <ExternalLink className="w-3 h-3" />
            Finding {linkedFindingId}
          </a>
        )}
      </div>
    </div>
  );
}
