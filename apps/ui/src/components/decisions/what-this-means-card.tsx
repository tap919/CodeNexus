'use client';

import { cn } from '@/lib/utils';
import { useState } from 'react';
import { ChevronDown, TrendingUp, Zap } from 'lucide-react';

interface WhatThisMeansCardProps {
  laymanSummary: string;
  technicalDetail: string;
  blastRadiusSummary: string;
  confidenceScore: number;
}

export function WhatThisMeansCard({
  laymanSummary,
  technicalDetail,
  blastRadiusSummary,
  confidenceScore,
}: WhatThisMeansCardProps) {
  const [expanded, setExpanded] = useState(false);

  const confidenceColor =
    confidenceScore >= 70 ? 'text-intent-success' :
    confidenceScore >= 40 ? 'text-intent-warning' :
    'text-intent-critical';

  const confidenceBg =
    confidenceScore >= 70 ? 'bg-intent-success/10' :
    confidenceScore >= 40 ? 'bg-intent-warning/10' :
    'bg-intent-critical/10';

  const ringColor =
    confidenceScore >= 70 ? 'stroke-intent-success' :
    confidenceScore >= 40 ? 'stroke-intent-warning' :
    'stroke-intent-critical';

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg-primary tracking-tight">What This Means</h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded-md hover:bg-surface-elevated transition-colors"
        >
          <ChevronDown
            className={cn(
              'w-4 h-4 text-fg-muted transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>
      </div>

      <p className="text-xs text-fg-primary leading-relaxed">{laymanSummary}</p>

      <div className="flex items-center gap-2">
        <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
          <svg className="w-10 h-10 -rotate-90">
            <circle cx="20" cy="20" r="16" className="fill-none stroke-border-subtle" strokeWidth="3" />
            <circle
              cx="20"
              cy="20"
              r="16"
              className={cn('fill-none', ringColor)}
              strokeWidth="3"
              strokeDasharray={`${(confidenceScore / 100) * 100.5} 100.5`}
              strokeLinecap="round"
            />
          </svg>
          <span className={cn('absolute text-[10px] font-bold tabular-nums', confidenceColor)}>
            {confidenceScore}
          </span>
        </div>
        <div>
          <p className={cn('text-xs font-semibold', confidenceColor)}>
            {confidenceScore >= 70 ? 'High' : confidenceScore >= 40 ? 'Moderate' : 'Low'} Confidence
          </p>
          <p className="text-[10px] text-fg-disabled">AI certainty score</p>
        </div>
      </div>

      {expanded && (
        <>
          <div className="border-t border-border-subtle pt-3 space-y-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="w-3 h-3 text-intent-warning" />
                <p className="text-[10px] text-fg-disabled uppercase tracking-wider font-medium">Technical Detail</p>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">{technicalDetail}</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="w-3 h-3 text-intent-critical" />
                <p className="text-[10px] text-fg-disabled uppercase tracking-wider font-medium">Blast Radius</p>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">{blastRadiusSummary}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
