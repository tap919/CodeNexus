'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { ChevronDown, Pin, PinOff, FileText, ExternalLink } from 'lucide-react';
import { useState } from 'react';

interface EvidenceResult {
  id: string;
  title: string;
  source: string;
  trustTier: 'internal' | 'standard' | 'vendor' | 'community';
  whyMatched: string;
  supportedFinding?: string;
  citation: string;
  freshness: string;
  snippet: string;
}

interface EvidenceGroup {
  group: 'supports' | 'contradicts' | 'similar_incident' | 'background';
  label: string;
  results: EvidenceResult[];
}

interface EvidenceGroupListProps {
  groups: EvidenceGroup[];
  onResultClick: (result: EvidenceResult) => void;
  pinned?: string[];
  onPin: (id: string) => void;
}

const tierBadgeColors: Record<string, string> = {
  internal: 'bg-intent-action/15 text-intent-action',
  standard: 'bg-intent-evidence/15 text-intent-evidence',
  vendor: 'bg-intent-warning/15 text-intent-warning',
  community: 'bg-fg-disabled/15 text-fg-disabled',
};

const tierDotColors: Record<string, string> = {
  internal: 'bg-intent-action',
  standard: 'bg-intent-evidence',
  vendor: 'bg-intent-warning',
  community: 'bg-fg-disabled',
};

const groupStyles: Record<string, { border: string; bg: string; dot: string }> = {
  supports: {
    border: 'border-l-intent-success',
    bg: 'bg-intent-success/5',
    dot: 'bg-intent-success',
  },
  contradicts: {
    border: 'border-l-intent-critical',
    bg: 'bg-intent-critical/5',
    dot: 'bg-intent-critical',
  },
  similar_incident: {
    border: 'border-l-intent-warning',
    bg: 'bg-intent-warning/5',
    dot: 'bg-intent-warning',
  },
  background: {
    border: 'border-l-fg-disabled',
    bg: 'bg-surface-elevated',
    dot: 'bg-fg-disabled',
  },
};

export function EvidenceGroupList({ groups, onResultClick, pinned = [], onPin }: EvidenceGroupListProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleGroup = (group: string) => {
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isCollapsed = collapsed[group.group] ?? false;
        const style = groupStyles[group.group];
        const resultCount = group.results.length;

        return (
          <div key={group.group}>
            <button
              type="button"
              onClick={() => toggleGroup(group.group)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-t-lg transition-colors',
                style.bg,
                isCollapsed && 'rounded-b-lg'
              )}
            >
              <span className={cn('w-2 h-2 rounded-full shrink-0', style.dot)} />
              <span className="text-xs font-medium text-fg-primary flex-1 text-left">
                {group.label}
              </span>
              <span className="text-[10px] text-fg-disabled font-mono">{resultCount}</span>
              <ChevronDown
                className={cn(
                  'w-3.5 h-3.5 text-fg-muted transition-transform',
                  isCollapsed && '-rotate-90'
                )}
              />
            </button>

            {!isCollapsed && (
              <div className={cn('border-l-2 rounded-b-lg overflow-hidden', style.border)}>
                {group.results.map((result) => {
                  const isPinned = pinned.includes(result.id);
                  return (
                    <div
                      key={result.id}
                      className={cn(
                        'px-3 py-3 border-b border-border-subtle last:border-b-0 transition-colors',
                        'hover:bg-surface-elevated cursor-pointer'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0" onClick={() => onResultClick(result)}>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-medium text-fg-primary truncate">
                              {result.title}
                            </span>
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider shrink-0',
                              tierBadgeColors[result.trustTier]
                            )}>
                              {result.trustTier}
                            </span>
                          </div>

                          <p className="text-xs text-fg-muted mb-1.5">
                            <span className="text-intent-evidence">Why:</span> {result.whyMatched}
                          </p>

                          <div className="flex items-center gap-3 text-[10px] text-fg-disabled">
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {result.source}
                            </span>
                            <span>{result.citation}</span>
                            <span>{formatRelativeTime(result.freshness)}</span>
                          </div>

                          <p className="text-xs text-fg-muted mt-2 line-clamp-2 bg-surface rounded-md p-2 border border-border-subtle font-mono">
                            {result.snippet}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onPin(result.id); }}
                          className={cn(
                            'p-1 rounded transition-colors shrink-0',
                            isPinned
                              ? 'text-intent-action hover:text-intent-action-hover'
                              : 'text-fg-disabled hover:text-fg-muted'
                          )}
                        >
                          {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type { EvidenceResult, EvidenceGroup };
