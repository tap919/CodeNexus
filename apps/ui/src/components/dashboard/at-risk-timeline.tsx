'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { AlertTriangle, GitPullRequest, TrendingDown, CheckCircle2, Clock } from 'lucide-react';

interface TimelineEvent {
  id: string;
  type: 'escalation' | 'review' | 'regression' | 'completed';
  title: string;
  repo: string;
  prNumber: number;
  timestamp: string;
  severity: 'critical' | 'high' | 'medium';
}

const MOCK_EVENTS: TimelineEvent[] = [
  { id: '1', type: 'escalation', title: 'Auth race condition detected', repo: 'codenexus/auth-service', prNumber: 142, timestamp: new Date(Date.now() - 120000).toISOString(), severity: 'critical' },
  { id: '2', type: 'review', title: 'Security middleware bypass found', repo: 'codenexus/security', prNumber: 138, timestamp: new Date(Date.now() - 600000).toISOString(), severity: 'high' },
  { id: '3', type: 'regression', title: 'Build failed after type change', repo: 'codenexus/shared', prNumber: 140, timestamp: new Date(Date.now() - 1800000).toISOString(), severity: 'medium' },
  { id: '4', type: 'completed', title: 'KB engine path traversal fix merged', repo: 'codenexus/knowledge', prNumber: 135, timestamp: new Date(Date.now() - 3600000).toISOString(), severity: 'medium' },
];

const typeIcons = {
  escalation: AlertTriangle,
  review: GitPullRequest,
  regression: TrendingDown,
  completed: CheckCircle2,
};

const severityBorder = {
  critical: 'border-l-intent-critical',
  high: 'border-l-intent-warning',
  medium: 'border-l-fg-muted',
};

export function AtRiskTimeline() {
  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-fg-primary">At-Risk Timeline</h3>
        <span className="text-[10px] text-fg-muted">Last 24h</span>
      </div>
      <div className="space-y-0">
        {MOCK_EVENTS.map((event, i) => {
          const Icon = typeIcons[event.type];
          return (
            <button
              key={event.id}
              className={cn(
                'w-full flex items-start gap-3 px-3 py-2.5 hover:bg-surface-elevated transition-colors text-left border-l-2',
                severityBorder[event.severity],
                i === 0 && 'rounded-t-lg',
                i === MOCK_EVENTS.length - 1 && 'rounded-b-lg',
              )}
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-fg-primary truncate">{event.title}</p>
                <p className="text-[11px] text-fg-muted">
                  {event.repo} · PR #{event.prNumber}
                </p>
              </div>
              <span className="text-[10px] text-fg-disabled shrink-0">
                {formatRelativeTime(event.timestamp)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
