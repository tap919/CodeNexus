'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingUp } from 'lucide-react';

interface LikelyRootCauseCardProps {
  causes: string[];
  confidence: number;
}

export function LikelyRootCauseCard({ causes, confidence }: LikelyRootCauseCardProps) {
  const confidenceColor =
    confidence >= 80
      ? 'text-intent-success'
      : confidence >= 50
        ? 'text-intent-warning'
        : 'text-intent-critical';

  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-intent-warning" />
          <h3 className="text-sm font-medium text-fg-primary">Likely Root Causes</h3>
        </div>
        <span
          className={cn(
            'text-[11px] px-2 py-0.5 rounded-full border',
            confidence >= 80
              ? 'bg-intent-success/10 text-intent-success border-intent-success/30'
              : confidence >= 50
                ? 'bg-intent-warning/10 text-intent-warning border-intent-warning/30'
                : 'bg-intent-critical/10 text-intent-critical border-intent-critical/30'
          )}
        >
          {confidence}% confidence
        </span>
      </div>

      <ul className="space-y-1.5">
        {causes.map((cause, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-fg-muted mt-1.5 shrink-0" />
            <span className="text-xs text-fg-primary">{cause}</span>
          </li>
        ))}
      </ul>

      {causes.length === 0 && (
        <p className="text-xs text-fg-disabled text-center py-3">
          No root causes identified yet. Run additional traces to gather more data.
        </p>
      )}
    </div>
  );
}
