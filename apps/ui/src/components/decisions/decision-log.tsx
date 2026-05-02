'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { CheckCircle2, Ticket, ArrowUpCircle, XCircle, FileText, Scale, MessageSquare } from 'lucide-react';

interface DecisionLogEntry {
  id: string;
  action: string;
  reviewer: string;
  timestamp: string;
  comment?: string;
  evidenceAttached: boolean;
  policyOverridden: boolean;
}

interface DecisionLogProps {
  entries: DecisionLogEntry[];
}

const actionConfig: Record<string, { icon: typeof CheckCircle2; bg: string; text: string; label: string }> = {
  approve_fix: { icon: CheckCircle2, bg: 'bg-intent-success/10', text: 'text-intent-success', label: 'Approved Fix' },
  approve_ticket: { icon: Ticket, bg: 'bg-intent-action/10', text: 'text-intent-action', label: 'Ticket Filed' },
  escalate: { icon: ArrowUpCircle, bg: 'bg-intent-warning/10', text: 'text-intent-warning', label: 'Escalated' },
  reject: { icon: XCircle, bg: 'bg-intent-critical/10', text: 'text-intent-critical', label: 'Rejected' },
};

export function DecisionLog({ entries }: DecisionLogProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface p-8 text-center">
        <MessageSquare className="w-6 h-6 text-fg-disabled mx-auto mb-2" />
        <p className="text-xs text-fg-muted">No decisions recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4 space-y-3">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Decision Log</h3>
      <div className="space-y-1">
        {entries.map((entry) => {
          const config = actionConfig[entry.action];
          const Icon = config.icon;

          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-elevated transition-colors"
            >
              <div className={cn('p-1 rounded-md shrink-0', config.bg)}>
                <Icon className={cn('w-3.5 h-3.5', config.text)} />
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('text-[11px] font-semibold', config.text)}>{config.label}</span>
                  <span className="text-[11px] text-fg-primary font-medium">{entry.reviewer}</span>
                  <span className="text-[10px] text-fg-disabled">{formatRelativeTime(entry.timestamp)}</span>
                  {entry.evidenceAttached && (
                    <FileText className="w-3 h-3 text-intent-evidence" />
                  )}
                  {entry.policyOverridden && (
                    <Scale className="w-3 h-3 text-intent-warning" />
                  )}
                </div>
                {entry.comment && (
                  <p className="text-[11px] text-fg-muted leading-relaxed">{entry.comment}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
