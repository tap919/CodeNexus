'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, Shield, Database, FileSearch } from 'lucide-react';

const MOCK_RISKS = [
  { subsystem: 'Auth Service', risk: 72, findings: 4, type: 'critical' },
  { subsystem: 'Security Detectors', risk: 58, findings: 3, type: 'high' },
  { subsystem: 'CLI Generator', risk: 45, findings: 2, type: 'medium' },
  { subsystem: 'Knowledge Engine', risk: 35, findings: 1, type: 'low' },
];

const riskColors = {
  critical: 'bg-intent-critical',
  high: 'bg-intent-warning',
  medium: 'bg-intent-evidence',
  low: 'bg-intent-success',
};

export function TopSubsystemRisks() {
  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <h3 className="text-sm font-medium text-fg-primary mb-3">Top Subsystem Risks</h3>
      <div className="space-y-2">
        {MOCK_RISKS.map((risk) => (
          <button
            key={risk.subsystem}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-elevated transition-colors text-left"
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', riskColors[risk.type])} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-fg-primary">{risk.subsystem}</p>
              <p className="text-[11px] text-fg-muted">{risk.findings} findings</p>
            </div>
            <div className="w-16 bg-surface-elevated rounded-full h-1.5 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', riskColors[risk.type])} style={{ width: `${risk.risk}%` }} />
            </div>
            <span className="text-xs font-mono text-fg-muted w-8 text-right">{risk.risk}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
