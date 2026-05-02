'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface PulseProps {
  healthScore: number;
  trend: 'up' | 'down' | 'stable';
  activeAgents: number;
  queuedReviews: number;
}

export function BuildHealthPulseCard({ healthScore, trend, activeAgents, queuedReviews }: Partial<PulseProps>) {
  const score = healthScore ?? 78;
  const trendDir = trend ?? 'stable';
  const agents = activeAgents ?? 3;
  const queued = queuedReviews ?? 2;

  const scoreColor = score >= 80 ? 'text-intent-success' : score >= 50 ? 'text-intent-warning' : 'text-intent-critical';
  const ringColor = score >= 80 ? 'stroke-intent-success' : score >= 50 ? 'stroke-intent-warning' : 'stroke-intent-critical';

  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-fg-primary">Build Health Pulse</h3>
        <span className="text-[10px] text-fg-disabled bg-surface-elevated px-2 py-0.5 rounded">
          {score >= 80 ? 'Healthy' : score >= 50 ? 'Caution' : 'At Risk'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg className="w-16 h-16 -rotate-90">
            <circle cx="32" cy="32" r="28" className="fill-none stroke-border-subtle" strokeWidth="4" />
            <circle cx="32" cy="32" r="28" className={cn('fill-none', ringColor)} strokeWidth="4"
              strokeDasharray={`${(score / 100) * 175.9} 175.9`} strokeLinecap="round" />
          </svg>
          <span className={cn('absolute text-lg font-bold', scoreColor)}>{score}</span>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-2">
          <div className="p-2 rounded-lg bg-surface-elevated">
            <div className="flex items-center gap-1 mb-1">
              <Activity className="w-3 h-3 text-intent-action" />
              <span className="text-[10px] text-fg-muted uppercase">Agents</span>
            </div>
            <span className="text-sm font-semibold text-fg-primary">{agents}</span>
          </div>
          <div className="p-2 rounded-lg bg-surface-elevated">
            <div className="flex items-center gap-1 mb-1">
              {trendDir === 'up' ? <TrendingUp className="w-3 h-3 text-intent-success" /> : trendDir === 'down' ? <TrendingDown className="w-3 h-3 text-intent-critical" /> : <Activity className="w-3 h-3 text-fg-muted" />}
              <span className="text-[10px] text-fg-muted uppercase">Trend</span>
            </div>
            <span className="text-sm font-semibold text-fg-primary">{trendDir}</span>
          </div>
          <div className="p-2 rounded-lg bg-surface-elevated col-span-2">
            <span className="text-[10px] text-fg-muted uppercase">Queued Reviews</span>
            <span className="text-sm font-semibold text-fg-primary ml-2">{queued}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
