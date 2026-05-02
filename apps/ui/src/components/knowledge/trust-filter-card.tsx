'use client';

import { cn } from '@/lib/utils';
import { SourceTierLegend } from './source-tier-legend';

interface TrustTier {
  id: string;
  label: string;
  count: number;
  enabled: boolean;
}

interface TrustFilterCardProps {
  tiers: TrustTier[];
  onToggleTier: (id: string) => void;
}

const tierColors: Record<string, string> = {
  internal: 'bg-intent-action',
  standard: 'bg-intent-evidence',
  vendor: 'bg-intent-warning',
  community: 'bg-fg-disabled',
};

const tierDotColors: Record<string, string> = {
  internal: 'after:bg-intent-action',
  standard: 'after:bg-intent-evidence',
  vendor: 'after:bg-intent-warning',
  community: 'after:bg-fg-disabled',
};

export function TrustFilterCard({ tiers, onToggleTier }: TrustFilterCardProps) {
  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <h3 className="text-xs font-medium text-fg-primary uppercase tracking-wider mb-3">Source Trust Tier</h3>

      <div className="mb-3">
        <SourceTierLegend />
      </div>

      <div className="space-y-1.5">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            type="button"
            onClick={() => onToggleTier(tier.id)}
            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-surface-elevated transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  'relative w-8 h-5 rounded-full transition-colors',
                  tier.enabled ? tierColors[tier.id] : 'bg-surface-overlay'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    tier.enabled ? 'left-[calc(100%-1.125rem)]' : 'left-0.5'
                  )}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', tierColors[tier.id])} />
                <span className={cn(
                  'text-sm transition-colors',
                  tier.enabled ? 'text-fg-primary' : 'text-fg-disabled'
                )}>
                  {tier.label}
                </span>
              </div>
            </div>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded font-mono transition-colors',
              tier.enabled ? 'text-fg-muted bg-surface-elevated' : 'text-fg-disabled bg-surface'
            )}>
              {tier.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
