'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Play, Columns, Camera } from 'lucide-react';

interface ScreenshotGridProps {
  primaryUrl: string;
  secondaryUrl?: string;
  stepLabel: string;
  hasBeforeAfter: boolean;
}

export function ScreenshotGrid({ primaryUrl, secondaryUrl, stepLabel, hasBeforeAfter }: ScreenshotGridProps) {
  const [compareMode, setCompareMode] = useState(false);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'grid gap-2',
          compareMode && hasBeforeAfter ? 'grid-cols-2' : 'grid-cols-1'
        )}
      >
        <div className="relative aspect-video rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-center overflow-hidden group">
          <Play className="w-8 h-8 text-fg-disabled group-hover:text-fg-muted transition-colors" />
          <div className="absolute bottom-2 left-2 text-[10px] text-fg-disabled bg-surface/80 px-1.5 py-0.5 rounded">
            Primary
          </div>
        </div>
        {compareMode && hasBeforeAfter && (
          <div className="relative aspect-video rounded-lg bg-surface-elevated border border-intent-critical/20 flex items-center justify-center overflow-hidden group">
            <Camera className="w-8 h-8 text-fg-disabled group-hover:text-fg-muted transition-colors" />
            <div className="absolute bottom-2 left-2 text-[10px] text-fg-disabled bg-surface/80 px-1.5 py-0.5 rounded">
              Before
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-fg-muted">{stepLabel}</span>
        {hasBeforeAfter && (
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-all border',
              compareMode
                ? 'bg-intent-action/10 text-intent-action border-intent-action/30'
                : 'text-fg-muted border-border-subtle hover:border-border-default'
            )}
          >
            <Columns className="w-3 h-3" />
            Before/After
          </button>
        )}
      </div>
    </div>
  );
}
