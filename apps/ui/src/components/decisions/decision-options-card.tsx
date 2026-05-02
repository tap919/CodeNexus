'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, Ticket, ArrowUpCircle, XCircle, FileText } from 'lucide-react';

interface DecisionOption {
  action: 'approve_fix' | 'approve_ticket' | 'escalate' | 'reject';
  label: string;
  consequence: string;
  requiredFollowUp: string;
  riskReduction: number;
  requiresEvidence: boolean;
}

interface DecisionOptionsCardProps {
  options: DecisionOption[];
  onSelect: (action: string) => void;
  selectedAction?: string;
}

const optionConfig: Record<string, { icon: typeof CheckCircle2; bg: string; border: string; ring: string; text: string; badgeBg: string; badgeText: string }> = {
  approve_fix: { icon: CheckCircle2, bg: 'bg-intent-success/5', border: 'border-intent-success', ring: 'ring-intent-success', text: 'text-intent-success', badgeBg: 'bg-intent-success/10', badgeText: 'text-intent-success' },
  approve_ticket: { icon: Ticket, bg: 'bg-intent-action/5', border: 'border-intent-action', ring: 'ring-intent-action', text: 'text-intent-action', badgeBg: 'bg-intent-action/10', badgeText: 'text-intent-action' },
  escalate: { icon: ArrowUpCircle, bg: 'bg-intent-warning/5', border: 'border-intent-warning', ring: 'ring-intent-warning', text: 'text-intent-warning', badgeBg: 'bg-intent-warning/10', badgeText: 'text-intent-warning' },
  reject: { icon: XCircle, bg: 'bg-intent-critical/5', border: 'border-intent-critical', ring: 'ring-intent-critical', text: 'text-intent-critical', badgeBg: 'bg-intent-critical/10', badgeText: 'text-intent-critical' },
};

export function DecisionOptionsCard({
  options,
  onSelect,
  selectedAction,
}: DecisionOptionsCardProps) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4 space-y-3">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Decision Options</h3>
      <div className="space-y-2">
        {options.map((option) => {
          const config = optionConfig[option.action];
          const isSelected = selectedAction === option.action;
          const Icon = config.icon;

          return (
            <button
              key={option.action}
              onClick={() => onSelect(option.action)}
              className={cn(
                'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all',
                config.bg,
                isSelected
                  ? cn('border', config.border, 'ring-1', config.ring)
                  : 'border border-transparent hover:border-border-subtle hover:bg-surface-elevated',
              )}
            >
              <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', config.text)} />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-fg-primary">{option.label}</span>
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', config.badgeBg, config.badgeText)}>
                    -{option.riskReduction}% risk
                  </span>
                  {option.requiresEvidence && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-elevated text-[10px] text-fg-muted">
                      <FileText className="w-3 h-3" />
                      evidence required
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-fg-muted leading-relaxed">{option.consequence}</p>
                <p className="text-[10px] text-fg-disabled">{option.requiredFollowUp}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
