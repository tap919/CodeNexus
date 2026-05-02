'use client';

import { cn } from '@/lib/utils';
import { Shield, TrendingUp, Users, Gauge, AlertTriangle, AlertOctagon, AlertCircle, Info } from 'lucide-react';

interface BuildImpactPanelProps {
  findingId: string;
  technicalSummary: string;
  laymanSummary: string;
  impactPercentages: {
    buildStability: number;
    securityPosture: number;
    userTrust: number;
    operationalOverhead: number;
  };
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendedAction: string;
}

const severityConfig = {
  critical: { icon: AlertOctagon, bg: 'bg-intent-critical/10', text: 'text-intent-critical', border: 'border-intent-critical/30', label: 'Critical' },
  high: { icon: AlertTriangle, bg: 'bg-intent-warning/10', text: 'text-intent-warning', border: 'border-intent-warning/30', label: 'High' },
  medium: { icon: AlertCircle, bg: 'bg-intent-evidence/10', text: 'text-intent-evidence', border: 'border-intent-evidence/30', label: 'Medium' },
  low: { icon: Info, bg: 'bg-intent-success/10', text: 'text-intent-success', border: 'border-intent-success/30', label: 'Low' },
};

const impactMeters = [
  { key: 'buildStability' as const, label: 'Build Stability', icon: Gauge, color: 'bg-intent-action' },
  { key: 'securityPosture' as const, label: 'Security Posture', icon: Shield, color: 'bg-intent-critical' },
  { key: 'userTrust' as const, label: 'User Trust', icon: Users, color: 'bg-intent-success' },
  { key: 'operationalOverhead' as const, label: 'Operational Overhead', icon: TrendingUp, color: 'bg-intent-warning' },
];

export function BuildImpactPanel({
  findingId,
  technicalSummary,
  laymanSummary,
  impactPercentages,
  severity,
  recommendedAction,
}: BuildImpactPanelProps) {
  const sev = severityConfig[severity];
  const SevIcon = sev.icon;

  return (
    <div className={cn('rounded-xl border bg-surface', sev.border)}>
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-fg-disabled uppercase tracking-wider font-medium">
              What this means to your build
            </p>
            <p className="text-sm font-semibold text-fg-primary mt-1 tracking-tight">
              {laymanSummary}
            </p>
          </div>
          <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0', sev.bg, sev.text)}>
            <SevIcon className="w-3 h-3" />
            {sev.label}
          </div>
        </div>

        <p className="text-[11px] text-fg-muted leading-relaxed">
          {technicalSummary}
        </p>

        <div className="space-y-2.5">
          {impactMeters.map((meter) => {
            const value = impactPercentages[meter.key];
            const MeterIcon = meter.icon;
            const barColor =
              value >= 66 ? 'bg-intent-critical' :
              value >= 33 ? 'bg-intent-warning' :
              meter.color;

            return (
              <div key={meter.key} className="flex items-center gap-3">
                <MeterIcon className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                <span className="text-[11px] text-fg-muted w-36 shrink-0">{meter.label}</span>
                <div className="flex-1 h-2 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', barColor)}
                    style={{ width: `${value}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-fg-primary w-10 text-right tabular-nums">
                  {value}%
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center text-[10px] text-fg-disabled">
          <span className="mr-1 opacity-50">#{findingId}</span>
        </div>
      </div>

      <div className="px-5 py-3 bg-surface-elevated/50 rounded-b-xl border-t border-border-subtle">
        <p className="text-[11px] text-fg-muted uppercase tracking-wider font-medium mb-1">Recommended Action</p>
        <p className="text-xs text-fg-primary font-medium">{recommendedAction}</p>
      </div>
    </div>
  );
}
