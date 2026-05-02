'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

export interface PolicyStatus {
  id: string;
  name: string;
  description: string;
  status: 'compliant' | 'partial' | 'noncompliant';
  lastChecked: string;
  details: string;
}

interface PolicyStatusGridProps {
  policies: PolicyStatus[];
}

const statusConfig = {
  compliant: {
    icon: CheckCircle2,
    text: 'text-intent-success',
    bg: 'bg-intent-success/10',
    border: 'border-intent-success/20',
    label: 'Compliant',
  },
  partial: {
    icon: AlertCircle,
    text: 'text-intent-warning',
    bg: 'bg-intent-warning/10',
    border: 'border-intent-warning/20',
    label: 'Partial',
  },
  noncompliant: {
    icon: XCircle,
    text: 'text-intent-critical',
    bg: 'bg-intent-critical/10',
    border: 'border-intent-critical/20',
    label: 'Noncompliant',
  },
};

export function PolicyStatusGrid({ policies }: PolicyStatusGridProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Policy Status</h3>
      <div className="grid grid-cols-2 gap-3">
        {policies.map((policy) => {
          const cfg = statusConfig[policy.status];
          const Icon = cfg.icon;

          return (
            <div
              key={policy.id}
              className={cn(
                'p-4 rounded-xl bg-surface border transition-all hover:bg-surface-elevated',
                cfg.border
              )}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h4 className="text-xs font-semibold text-fg-primary tracking-tight">
                  {policy.name}
                </h4>
                <span
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0',
                    cfg.bg,
                    cfg.text
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {cfg.label}
                </span>
              </div>

              <p className="text-[11px] text-fg-muted leading-relaxed mb-2">
                {policy.description}
              </p>

              <p className="text-[10px] text-fg-disabled mb-1">
                Last checked {formatRelativeTime(policy.lastChecked)}
              </p>

              <p className="text-[10px] text-fg-muted leading-relaxed">
                {policy.details}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
