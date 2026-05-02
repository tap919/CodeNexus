'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, AlertOctagon, AlertCircle } from 'lucide-react';

export interface TopRisk {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  count: number;
}

interface TopRisksCardProps {
  risks: TopRisk[];
}

const severityConfig = {
  critical: {
    icon: AlertOctagon,
    text: 'text-intent-critical',
    bg: 'bg-intent-critical/10',
    bar: 'bg-intent-critical',
    label: 'Critical',
  },
  high: {
    icon: AlertTriangle,
    text: 'text-intent-warning',
    bg: 'bg-intent-warning/10',
    bar: 'bg-intent-warning',
    label: 'High',
  },
  medium: {
    icon: AlertCircle,
    text: 'text-intent-evidence',
    bg: 'bg-intent-evidence/10',
    bar: 'bg-intent-evidence',
    label: 'Medium',
  },
};

export function TopRisksCard({ risks }: TopRisksCardProps) {
  if (risks.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary tracking-tight">Top Risks</h3>
        <div className="p-4 rounded-xl bg-surface border border-border-subtle text-center">
          <AlertCircle className="w-5 h-5 text-intent-success mx-auto mb-1.5" />
          <p className="text-[11px] text-fg-muted">No active governance risks.</p>
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...risks.map((r) => r.count));

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Top Risks</h3>
      <div className="rounded-xl bg-surface border border-border-subtle p-4">
        <div className="space-y-3">
          {risks.map((risk) => {
            const cfg = severityConfig[risk.severity];
            const SevIcon = cfg.icon;
            const barWidth = maxCount > 0 ? (risk.count / maxCount) * 100 : 0;

            return (
              <button
                key={risk.id}
                className="w-full text-left group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <SevIcon className={cn('w-3.5 h-3.5 shrink-0', cfg.text)} />
                    <span className="text-[11px] text-fg-primary font-medium truncate">
                      {risk.title}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 ml-2',
                      cfg.bg,
                      cfg.text
                    )}
                  >
                    {cfg.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', cfg.bar)}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-fg-muted w-8 text-right tabular-nums">
                    {risk.count}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
