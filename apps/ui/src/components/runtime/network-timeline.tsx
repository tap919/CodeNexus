'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

export interface NetworkEntry {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  status: number;
  duration: number;
  correlationId: string;
  failed: boolean;
}

interface NetworkTimelineProps {
  entries: NetworkEntry[];
  filter: 'all' | 'failed' | 'auth' | 'mutation' | 'slow';
  onFilterChange: (filter: string) => void;
}

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'auth', label: 'Auth' },
  { key: 'mutation', label: 'Mutations' },
  { key: 'slow', label: 'Slow (>1s)' },
] as const;

const methodColors: Record<string, string> = {
  GET: 'bg-intent-evidence/20 text-intent-evidence',
  POST: 'bg-intent-action/20 text-intent-action',
  PUT: 'bg-intent-warning/20 text-intent-warning',
  DELETE: 'bg-intent-critical/20 text-intent-critical',
};

const methodBadge: Record<string, string> = {
  GET: 'border-intent-evidence/40',
  POST: 'border-intent-action/40',
  PUT: 'border-intent-warning/40',
  DELETE: 'border-intent-critical/40',
};

function statusColor(code: number): string {
  if (code >= 500) return 'text-intent-critical';
  if (code >= 400) return 'text-intent-warning';
  if (code >= 300) return 'text-intent-evidence';
  if (code >= 200) return 'text-intent-success';
  return 'text-fg-disabled';
}

export function NetworkTimeline({ entries, filter, onFilterChange }: NetworkTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredEntries = entries.filter((e) => {
    switch (filter) {
      case 'failed':
        return e.failed;
      case 'auth':
        return e.url.includes('/auth') || e.url.includes('/token');
      case 'mutation':
        return e.method === 'POST' || e.method === 'PUT' || e.method === 'DELETE';
      case 'slow':
        return e.duration > 1000;
      default:
        return true;
    }
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onFilterChange(tab.key)}
            className={cn(
              'px-2.5 py-1 rounded text-[11px] whitespace-nowrap transition-all border',
              filter === tab.key
                ? 'bg-intent-action/10 text-intent-action border-intent-action/30'
                : 'text-fg-muted border-border-subtle hover:border-border-default'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-0.5">
        {filteredEntries.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-fg-disabled">
            No network entries match the current filter.
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const maxDuration = Math.max(...filteredEntries.map((e) => e.duration), 1);
            const barWidth = `${Math.min((entry.duration / maxDuration) * 100, 100)}%`;

            return (
              <div
                key={entry.id}
                className={cn(
                  'rounded-lg transition-colors',
                  entry.failed && 'bg-intent-critical/5 border border-intent-critical/20',
                  !entry.failed && 'border border-border-subtle'
                )}
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                >
                  {entry.failed && (
                    <AlertTriangle className="w-3.5 h-3.5 text-intent-critical shrink-0" />
                  )}
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0',
                      methodColors[entry.method],
                      methodBadge[entry.method]
                    )}
                  >
                    {entry.method}
                  </span>
                  <span className="text-[11px] text-fg-primary truncate flex-1 min-w-0">
                    {entry.url}
                  </span>
                  <span className={cn('text-[11px] font-mono shrink-0', statusColor(entry.status))}>
                    {entry.status}
                  </span>
                  <div className="w-16 h-1.5 rounded-full bg-surface-elevated overflow-hidden shrink-0">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        entry.failed ? 'bg-intent-critical' : entry.duration > 1000 ? 'bg-intent-warning' : 'bg-intent-action'
                      )}
                      style={{ width: barWidth }}
                    />
                  </div>
                  <span className="text-[10px] text-fg-disabled w-10 text-right shrink-0">
                    {entry.duration}ms
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-3 pb-2 pt-1 space-y-1 border-t border-border-subtle">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-fg-disabled uppercase">Correlation ID</span>
                        <p className="text-[11px] text-fg-primary font-mono">{entry.correlationId}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-fg-disabled uppercase">Duration</span>
                        <p className="text-[11px] text-fg-primary">{entry.duration}ms</p>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-fg-disabled uppercase">Status</span>
                      <p className={cn('text-[11px] font-mono', statusColor(entry.status))}>
                        {entry.failed ? 'Request Failed' : `HTTP ${entry.status}`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
