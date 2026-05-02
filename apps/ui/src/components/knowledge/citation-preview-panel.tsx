'use client';

import { cn } from '@/lib/utils';
import { X, ChevronRight, FileText, ExternalLink } from 'lucide-react';

interface CitationPreviewPanelProps {
  title: string;
  citation: string;
  snippet: string;
  provenance: string[];
  matchedSection: string;
  onClose: () => void;
}

export function CitationPreviewPanel({
  title,
  citation,
  snippet,
  provenance,
  matchedSection,
  onClose,
}: CitationPreviewPanelProps) {
  const highlightMatch = (text: string, match: string) => {
    const idx = text.toLowerCase().indexOf(match.toLowerCase());
    if (idx === -1) return text;

    const before = text.slice(0, idx);
    const highlighted = text.slice(idx, idx + match.length);
    const after = text.slice(idx + match.length);

    return (
      <>
        {before}
        <mark className="bg-intent-warning/30 text-intent-warning px-0.5 rounded-sm">{highlighted}</mark>
        {after}
      </>
    );
  };

  return (
    <div className="rounded-xl bg-surface border border-border-subtle overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-fg-muted shrink-0" />
          <h3 className="text-sm font-medium text-fg-primary truncate">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-elevated text-fg-muted hover:text-fg-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <span className="text-[10px] text-fg-disabled uppercase tracking-wider">Provenance</span>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {provenance.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-xs text-fg-muted bg-surface-elevated px-2 py-0.5 rounded">
                  {step}
                </span>
                {i < provenance.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-fg-disabled" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="text-[10px] text-fg-disabled uppercase tracking-wider">Citation</span>
          <p className="text-xs text-fg-muted mt-1 font-mono bg-surface-elevated px-2.5 py-1.5 rounded-md">
            {citation}
          </p>
        </div>

        <div>
          <span className="text-[10px] text-fg-disabled uppercase tracking-wider">Matched Section</span>
          <p className="text-xs text-intent-evidence mt-1 font-medium">{matchedSection}</p>
        </div>

        <div>
          <span className="text-[10px] text-fg-disabled uppercase tracking-wider">Snippet</span>
          <div className="mt-1.5 p-3 rounded-lg bg-surface-elevated border border-border-subtle text-xs text-fg-primary leading-relaxed font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
            {highlightMatch(snippet, matchedSection)}
          </div>
        </div>

        <button
          type="button"
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-intent-action/10 text-intent-action hover:bg-intent-action/20 text-xs font-medium transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open source document
        </button>
      </div>
    </div>
  );
}
