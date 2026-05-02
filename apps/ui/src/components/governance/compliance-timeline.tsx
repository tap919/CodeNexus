'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, FileText, Search } from 'lucide-react';

export interface ComplianceEvent {
  id: string;
  date: string;
  event: string;
  type: 'fix' | 'regression' | 'policy_change' | 'audit';
  details: string;
}

interface ComplianceTimelineProps {
  events: ComplianceEvent[];
}

const typeConfig = {
  fix: {
    icon: CheckCircle2,
    dotBg: 'bg-intent-success',
    lineColor: 'border-intent-success/30',
  },
  regression: {
    icon: AlertTriangle,
    dotBg: 'bg-intent-critical',
    lineColor: 'border-intent-critical/30',
  },
  policy_change: {
    icon: FileText,
    dotBg: 'bg-intent-action',
    lineColor: 'border-intent-action/30',
  },
  audit: {
    icon: Search,
    dotBg: 'bg-fg-disabled',
    lineColor: 'border-fg-disabled/30',
  },
};

export function ComplianceTimeline({ events }: ComplianceTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary tracking-tight">Compliance Timeline</h3>
        <div className="p-4 rounded-xl bg-surface border border-border-subtle text-center">
          <Search className="w-5 h-5 text-fg-disabled mx-auto mb-1.5" />
          <p className="text-[11px] text-fg-muted">No compliance events recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Compliance Timeline</h3>
      <div className="relative pl-6">
        {events.map((evt, i) => {
          const cfg = typeConfig[evt.type];
          const DotIcon = cfg.icon;
          const isLast = i === events.length - 1;

          return (
            <div key={evt.id} className="relative pb-4 last:pb-0">
              {!isLast && (
                <div
                  className={cn(
                    'absolute left-0 top-5 bottom-0 w-px border-l -translate-x-1/2',
                    cfg.lineColor
                  )}
                />
              )}

              <div
                className={cn(
                  'absolute left-0 top-1 w-4 h-4 rounded-full flex items-center justify-center -translate-x-1/2',
                  cfg.dotBg
                )}
              >
                <DotIcon className="w-2.5 h-2.5 text-white" />
              </div>

              <div className="pl-3">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] text-fg-disabled font-mono">
                    {formatRelativeTime(evt.date)}
                  </span>
                </div>
                <p className="text-xs font-semibold text-fg-primary tracking-tight">
                  {evt.event}
                </p>
                <p className="text-[11px] text-fg-muted leading-relaxed mt-0.5">
                  {evt.details}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
