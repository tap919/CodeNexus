'use client';

import { useDashboardStore } from '@/stores/dashboard-store';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { GitPullRequest, AlertTriangle, TrendingDown, CheckCircle2, Clock } from 'lucide-react';

const KPI_ITEMS = [
  { key: 'openReviews', label: 'Open Reviews', icon: GitPullRequest, intent: 'action' },
  { key: 'atRiskPRs', label: 'At-Risk PRs', icon: AlertTriangle, intent: 'warning' },
  { key: 'escalationsWaiting', label: 'Escalations', icon: Clock, intent: 'critical' },
  { key: 'regressedBuilds', label: 'Regressed', icon: TrendingDown, intent: 'critical' },
  { key: 'healthyMerges', label: 'Healthy', icon: CheckCircle2, intent: 'success' },
] as const;

const intentColors = {
  action: 'text-intent-action',
  warning: 'text-intent-warning',
  critical: 'text-intent-critical',
  success: 'text-intent-success',
};

export function KPIStrip() {
  const { metrics } = useDashboardStore();
  const relativeTime = formatRelativeTime(metrics.lastUpdated);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg-primary tracking-tight">System Health</h2>
        <span className="text-[10px] text-fg-disabled">Updated {relativeTime}</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {KPI_ITEMS.map((item) => {
          const value = metrics[item.key] ?? 0;
          return (
            <button
              key={item.key}
              className="group flex flex-col gap-1 p-3 rounded-xl bg-surface border border-border-subtle hover:border-border-default transition-all hover:bg-surface-elevated text-left"
            >
              <div className="flex items-center gap-2">
                <item.icon className={cn('w-4 h-4', intentColors[item.intent])} />
                <span className="text-[11px] text-fg-muted uppercase tracking-wider">{item.label}</span>
              </div>
              <span className={cn('text-2xl font-semibold tracking-tight', intentColors[item.intent])}>
                {value}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
