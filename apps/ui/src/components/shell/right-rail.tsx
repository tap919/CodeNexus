'use client';

import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import {
  EyeOff, AlertTriangle, Shield, Database, Brain,
  GitPullRequest, type LucideIcon,
} from 'lucide-react';

interface RailCard {
  id: string;
  title: string;
  icon: LucideIcon;
  intent: 'warning' | 'critical' | 'evidence' | 'muted';
  summary: string;
  detail?: string;
}

const MOCK_CARDS: RailCard[] = [
  {
    id: 'blindspot',
    title: 'Things the system might miss',
    icon: EyeOff,
    intent: 'warning',
    summary: 'Cross-module side effects in auth flow',
    detail: 'The argon2 hash change affects 3 downstream services that expect the old hash format.',
  },
  {
    id: 'impact',
    title: 'What this means to your build',
    icon: AlertTriangle,
    intent: 'critical',
    summary: '+23% blast radius',
    detail: 'Changes to shared types will trigger rebuilds in 7 packages.',
  },
  {
    id: 'evidence',
    title: 'Evidence',
    icon: Database,
    intent: 'evidence',
    summary: '2 Playwright traces, 1 screenshot',
    detail: 'Race condition verified in authz.idor.spec.ts — session isolation holds.',
  },
  {
    id: 'confidence',
    title: 'Confidence',
    icon: Brain,
    intent: 'muted',
    summary: 'Overall: Medium (0.62)',
    detail: 'High on auth fixes. Low on knowledge engine parser changes.',
  },
];

function RailCardItem({ card }: { card: RailCard }) {
  const intents = {
    warning: 'border-l-intent-warning text-intent-warning',
    critical: 'border-l-intent-critical text-intent-critical',
    evidence: 'border-l-intent-evidence text-intent-evidence',
    muted: 'border-l-fg-muted text-fg-muted',
  };

  return (
    <div className={cn('pl-3 py-2 border-l-2', intents[card.intent])}>
      <div className="flex items-center gap-2">
        <card.icon className="w-3.5 h-3.5 shrink-0" />
        <p className="text-[11px] font-medium uppercase tracking-wider">{card.title}</p>
      </div>
      <p className="text-xs text-fg-primary mt-1 leading-relaxed">{card.summary}</p>
      {card.detail && (
        <p className="text-[11px] text-fg-muted mt-0.5 leading-relaxed">{card.detail}</p>
      )}
    </div>
  );
}

export function RightRail() {
  const { mode } = useUIStore();

  const decisionActions = [
    { label: 'Approve with fix', intent: 'bg-intent-success/20 text-intent-success border-intent-success/30' },
    { label: 'Approve with ticket', intent: 'bg-intent-action/20 text-intent-action border-intent-action/30' },
    { label: 'Escalate', intent: 'bg-intent-warning/20 text-intent-warning border-intent-warning/30' },
    { label: 'Reject', intent: 'bg-intent-critical/20 text-intent-critical border-intent-critical/30' },
  ];

  return (
    <aside className="h-full flex flex-col bg-surface border-l border-border-subtle overflow-y-auto">
      <div className="p-3 border-b border-border-subtle">
        <p className="text-[10px] uppercase tracking-widest text-fg-disabled mb-1">Consequence Rail</p>
        <p className="text-xs text-fg-muted">Uncertainty, proof, action.</p>
      </div>

      <div className="flex-1 flex flex-col gap-0.5 p-2">
        {MOCK_CARDS.map((card) => (
          <RailCardItem key={card.id} card={card} />
        ))}
      </div>

      <div className="p-3 border-t border-border-subtle">
        <p className="text-[10px] uppercase tracking-widest text-fg-disabled mb-2">Decision Actions</p>
        <div className="flex flex-col gap-1.5">
          {decisionActions.map((action) => (
            <button
              key={action.label}
              className={cn('w-full px-3 py-1.5 rounded text-xs font-medium border transition-colors hover:opacity-80', action.intent)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
