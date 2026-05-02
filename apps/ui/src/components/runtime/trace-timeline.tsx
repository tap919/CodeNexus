'use client';

import { cn } from '@/lib/utils';
import { Camera, Wifi, FileText } from 'lucide-react';

export interface TraceStep {
  id: string;
  stepNumber: number;
  action: string;
  status: 'passed' | 'failed' | 'running' | 'skipped';
  timestamp: string;
  duration: number;
  attachedArtifacts: ('screenshot' | 'network' | 'log')[];
}

interface TraceTimelineProps {
  steps: TraceStep[];
  selectedStepId?: string;
  onSelectStep: (stepId: string) => void;
}

const statusDot = {
  passed: 'bg-intent-success',
  failed: 'bg-intent-critical',
  running: 'bg-intent-action animate-pulse',
  skipped: 'bg-fg-disabled',
};

const statusRing = {
  passed: 'ring-intent-success/40',
  failed: 'ring-intent-critical/40',
  running: 'ring-intent-action/40',
  skipped: 'ring-fg-disabled/40',
};

const artifactIcons: Record<string, React.FC<{ className?: string }>> = {
  screenshot: Camera,
  network: Wifi,
  log: FileText,
};

export function TraceTimeline({ steps, selectedStepId, onSelectStep }: TraceTimelineProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex items-center min-w-max px-2 py-3 gap-0">
        {steps.map((step, i) => {
          const isSelected = step.id === selectedStepId;
          const Artifacts = step.attachedArtifacts
            .map((a) => artifactIcons[a])
            .filter(Boolean);

          return (
            <div key={step.id} className="flex items-center shrink-0">
              {i > 0 && (
                <div
                  className={cn(
                    'w-8 h-px mx-0.5',
                    step.status === 'skipped' ? 'bg-border-subtle' : 'bg-border-default'
                  )}
                />
              )}
              <button
                onClick={() => onSelectStep(step.id)}
                className={cn(
                  'flex flex-col items-center gap-1 px-1.5 py-1 rounded-lg transition-all group hover:bg-surface-elevated',
                  isSelected && 'bg-surface-elevated'
                )}
              >
                <span className="text-[10px] text-fg-disabled font-mono leading-none">
                  #{step.stepNumber}
                </span>
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center transition-all',
                    statusDot[step.status],
                    isSelected && `ring-2 ring-offset-2 ring-offset-canvas ${statusRing[step.status]}`
                  )}
                >
                  {step.status === 'running' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] whitespace-nowrap leading-none max-w-[72px] truncate',
                    isSelected ? 'text-fg-primary font-medium' : 'text-fg-muted'
                  )}
                >
                  {step.action}
                </span>
                <span className="text-[9px] text-fg-disabled leading-none">
                  {step.duration}ms
                </span>
                {isSelected && Artifacts.length > 0 && (
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {Artifacts.map((Icon, idx) => (
                      <Icon
                        key={idx}
                        className="w-2.5 h-2.5 text-fg-muted"
                      />
                    ))}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
