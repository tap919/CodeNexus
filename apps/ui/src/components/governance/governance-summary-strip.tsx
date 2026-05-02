'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import {
  Shield,
  AlertTriangle,
  UserCheck,
  XCircle,
  Clock,
} from 'lucide-react';

interface GovernanceSummaryStripProps {
  protectedBranchesCompliant: number;
  totalProtectedBranches: number;
  dangerousWorkflows: number;
  missingReviewers: number;
  failingChecks: number;
  stalePolicies: number;
}

const KPI_ITEMS = [
  { key: 'branches' as const, label: 'Branch Protection', icon: Shield },
  { key: 'workflows' as const, label: 'Dangerous Workflows', icon: AlertTriangle },
  { key: 'reviewers' as const, label: 'Missing Reviewers', icon: UserCheck },
  { key: 'checks' as const, label: 'Failing Checks', icon: XCircle },
  { key: 'policies' as const, label: 'Stale Policies', icon: Clock },
];

export function GovernanceSummaryStrip({
  protectedBranchesCompliant,
  totalProtectedBranches,
  dangerousWorkflows,
  missingReviewers,
  failingChecks,
  stalePolicies,
}: GovernanceSummaryStripProps) {
  const now = new Date().toISOString();

  const values = {
    branches: `${protectedBranchesCompliant}/${totalProtectedBranches}`,
    workflows: dangerousWorkflows,
    reviewers: missingReviewers,
    checks: failingChecks,
    policies: stalePolicies,
  };

  const getIntent = (key: string, val: number | string): string => {
    if (key === 'branches') {
      if (typeof val === 'string') {
        const [compliant, total] = val.split('/').map(Number);
        return compliant === total ? 'success' : total === 0 ? 'muted' : 'warning';
      }
      return 'muted';
    }
    return val === 0 || val === '0/0' ? 'success' : 'critical';
  };

  const intentConfig: Record<string, { text: string; bg: string }> = {
    success: { text: 'text-intent-success', bg: 'bg-intent-success' },
    warning: { text: 'text-intent-warning', bg: 'bg-intent-warning' },
    critical: { text: 'text-intent-critical', bg: 'bg-intent-critical' },
    muted: { text: 'text-fg-muted', bg: 'bg-fg-muted' },
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg-primary tracking-tight">Governance Overview</h2>
        <span className="text-[10px] text-fg-disabled">Updated {formatRelativeTime(now)}</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {KPI_ITEMS.map((item) => {
          const val = values[item.key];
          const intent = getIntent(item.key, val);
          const colors = intentConfig[intent] ?? intentConfig.muted;

          return (
            <div
              key={item.key}
              className="flex flex-col gap-1 p-3 rounded-xl bg-surface border border-border-subtle hover:border-border-default transition-all hover:bg-surface-elevated"
            >
              <div className="flex items-center gap-2">
                <item.icon className={cn('w-4 h-4', colors.text)} />
                <span className="text-[11px] text-fg-muted uppercase tracking-wider">
                  {item.label}
                </span>
              </div>
              <span className={cn('text-2xl font-semibold tracking-tight', colors.text)}>
                {val}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
