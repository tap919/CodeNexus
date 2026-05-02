'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface PolicyDriftCardProps {
  driftDetected: boolean;
  lastStableDate: string;
  changesSinceStable: number;
  affectedPolicies: string[];
}

export function PolicyDriftCard({
  driftDetected,
  lastStableDate,
  changesSinceStable,
  affectedPolicies,
}: PolicyDriftCardProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Policy Drift</h3>
      <div
        className={cn(
          'p-4 rounded-xl border transition-all',
          driftDetected
            ? 'bg-surface border-intent-warning/30'
            : 'bg-surface border-intent-success/30'
        )}
      >
        <div className="flex items-center gap-3 mb-3">
          {driftDetected ? (
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-intent-warning/10 shrink-0">
              <AlertTriangle className="w-5 h-5 text-intent-warning" />
            </div>
          ) : (
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-intent-success/10 shrink-0">
              <CheckCircle2 className="w-5 h-5 text-intent-success" />
            </div>
          )}
          <div>
            <p
              className={cn(
                'text-sm font-semibold',
                driftDetected ? 'text-intent-warning' : 'text-intent-success'
              )}
            >
              {driftDetected ? 'Drift Detected' : 'No Drift Detected'}
            </p>
            <p className="text-[10px] text-fg-disabled">
              Last stable {formatRelativeTime(lastStableDate)}
            </p>
          </div>
        </div>

        {driftDetected && (
          <>
            <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-intent-warning/5 border border-intent-warning/10">
              <span className="text-[11px] text-fg-muted">Changes since stable:</span>
              <span className="text-sm font-bold text-intent-warning tabular-nums">
                {changesSinceStable}
              </span>
            </div>

            <div>
              <p className="text-[10px] font-semibold text-fg-disabled uppercase tracking-wider mb-1.5">
                Affected Policies
              </p>
              <ul className="space-y-1">
                {affectedPolicies.map((policy) => (
                  <li
                    key={policy}
                    className="flex items-center gap-1.5 text-[11px] text-fg-muted"
                  >
                    <span className="w-1 h-1 rounded-full bg-intent-warning shrink-0" />
                    {policy}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
