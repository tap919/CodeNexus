'use client';

import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

const TIERS = [
  { id: 'internal', label: 'Internal', color: 'bg-intent-action' },
  { id: 'standard', label: 'Standard', color: 'bg-intent-evidence' },
  { id: 'vendor', label: 'Vendor', color: 'bg-intent-warning' },
  { id: 'community', label: 'Community', color: 'bg-fg-disabled' },
] as const;

export function SourceTierLegend() {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {TIERS.map((tier, i) => (
        <div key={tier.id} className="flex items-center gap-1">
          <span className={cn('w-2.5 h-2.5 rounded-full', tier.color)} />
          <span className="text-[10px] text-fg-muted leading-none">{tier.label}</span>
          {i < TIERS.length - 1 && (
            <ChevronRight className="w-3 h-3 text-fg-disabled" />
          )}
        </div>
      ))}
    </div>
  );
}
