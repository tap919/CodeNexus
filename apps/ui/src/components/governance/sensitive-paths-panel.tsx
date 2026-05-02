'use client';

import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertOctagon } from 'lucide-react';

export interface SensitivePath {
  path: string;
  risk: 'critical' | 'high';
  unmetControls: string[];
}

interface SensitivePathsPanelProps {
  paths: SensitivePath[];
}

const riskConfig = {
  critical: {
    icon: AlertOctagon,
    label: 'Critical',
    text: 'text-intent-critical',
    bg: 'bg-intent-critical/10',
    border: 'border-l-intent-critical',
  },
  high: {
    icon: AlertTriangle,
    label: 'High',
    text: 'text-intent-warning',
    bg: 'bg-intent-warning/10',
    border: 'border-l-intent-warning',
  },
};

export function SensitivePathsPanel({ paths }: SensitivePathsPanelProps) {
  if (paths.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary tracking-tight">Sensitive Paths</h3>
        <div className="p-4 rounded-xl bg-surface border border-border-subtle text-center">
          <Shield className="w-5 h-5 text-intent-success mx-auto mb-1.5" />
          <p className="text-[11px] text-fg-muted">No sensitive paths at risk.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Sensitive Paths</h3>
      <div className="space-y-2">
        {paths.map((sp) => {
          const cfg = riskConfig[sp.risk];
          const RiskIcon = cfg.icon;

          return (
            <div
              key={sp.path}
              className={cn(
                'p-4 rounded-xl bg-surface border border-border-subtle border-l-2 transition-all hover:bg-surface-elevated',
                cfg.border
              )}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className={cn('w-4 h-4 shrink-0', cfg.text)} />
                  <span className="text-xs font-mono font-semibold text-fg-primary truncate">
                    {sp.path}
                  </span>
                </div>
                <span
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0',
                    cfg.bg,
                    cfg.text
                  )}
                >
                  <RiskIcon className="w-3 h-3" />
                  {cfg.label}
                </span>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-fg-disabled uppercase tracking-wider mb-1.5">
                  Unmet Controls
                </p>
                <ul className="space-y-1">
                  {sp.unmetControls.map((ctrl) => (
                    <li
                      key={ctrl}
                      className="flex items-center gap-1.5 text-[11px] text-fg-muted"
                    >
                      <span
                        className={cn(
                          'w-1 h-1 rounded-full shrink-0',
                          sp.risk === 'critical' ? 'bg-intent-critical' : 'bg-intent-warning'
                        )}
                      />
                      {ctrl}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
