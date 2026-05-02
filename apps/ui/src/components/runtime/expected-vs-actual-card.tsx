'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight } from 'lucide-react';

interface ExpectedVsActualCardProps {
  expected: string;
  actual: string;
  invariantName: string;
}

export function ExpectedVsActualCard({ expected, actual, invariantName }: ExpectedVsActualCardProps) {
  return (
    <div className="p-3 rounded-xl bg-surface border border-border-subtle space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-fg-muted uppercase tracking-wider">Invariant</span>
        <span className="text-xs text-fg-primary font-medium">{invariantName}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-intent-success/5 border border-intent-success/20">
          <span className="text-[10px] text-intent-success uppercase tracking-wider">Expected</span>
          <p className="text-xs text-fg-primary mt-1">{expected}</p>
        </div>
        <div className="p-2 rounded-lg bg-intent-critical/5 border border-intent-critical/20">
          <span className="text-[10px] text-intent-critical uppercase tracking-wider">Actual</span>
          <p className="text-xs text-fg-primary mt-1">{actual}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 p-2 rounded-lg bg-intent-warning/5 border border-intent-warning/20">
        <AlertTriangle className="w-3.5 h-3.5 text-intent-warning mt-0.5 shrink-0" />
        <div>
          <span className="text-[10px] text-intent-warning uppercase tracking-wider">Likely Root Cause</span>
          <p className="text-[11px] text-fg-primary mt-0.5">
            State mismatch detected between expected invariant and actual runtime state.
            Review the affected subsystem for potential race conditions or configuration drift.
          </p>
        </div>
      </div>
    </div>
  );
}
