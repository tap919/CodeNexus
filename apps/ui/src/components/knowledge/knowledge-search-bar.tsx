'use client';

import { cn } from '@/lib/utils';
import { Search, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface KnowledgeSearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  scope: string;
  onScopeChange: (scope: string) => void;
}

const SCOPES = ['All', 'Files', 'Docs', 'Incidents'] as const;

export function KnowledgeSearchBar({ query, onQueryChange, scope, onScopeChange }: KnowledgeSearchBarProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="flex items-stretch rounded-xl bg-surface border border-border-subtle focus-within:border-intent-action transition-colors overflow-hidden">
      <div className="relative flex items-center" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="h-full pl-4 pr-2 flex items-center gap-1.5 text-sm text-fg-primary hover:text-fg-secondary transition-colors"
        >
          {scope}
          <ChevronDown className="w-3.5 h-3.5 text-fg-muted" />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 w-32 rounded-lg bg-surface-elevated border border-border-subtle shadow-lg z-20 py-1">
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { onScopeChange(s); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm transition-colors',
                  s === scope ? 'text-fg-primary bg-surface-overlay' : 'text-fg-muted hover:text-fg-primary hover:bg-surface'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="w-px h-6 bg-border-subtle" />
      </div>

      <div className="flex items-center flex-1 px-3 gap-2">
        <Search className="w-4 h-4 text-fg-disabled shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search trusted documentation and incident history..."
          className="flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-disabled outline-none py-2.5"
        />
      </div>
    </div>
  );
}
