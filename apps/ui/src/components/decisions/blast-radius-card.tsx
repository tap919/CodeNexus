'use client';

import { cn } from '@/lib/utils';
import { ArrowRight, AlertTriangle, Shield } from 'lucide-react';

interface BlastRadiusCardProps {
  affectedServices: string[];
  affectedUserJourneys: string[];
  downstreamFailurePath: string;
  trustBoundaryCrossed: boolean;
}

const serviceColors = [
  'bg-intent-action',
  'bg-intent-warning',
  'bg-intent-critical',
  'bg-intent-evidence',
  'bg-intent-success',
  'bg-fg-muted',
];

export function BlastRadiusCard({
  affectedServices,
  affectedUserJourneys,
  downstreamFailurePath,
  trustBoundaryCrossed,
}: BlastRadiusCardProps) {
  const pathSegments = downstreamFailurePath.split('→').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg-primary tracking-tight">Blast Radius</h3>
        {trustBoundaryCrossed && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-intent-critical/10 text-intent-critical text-[10px] font-semibold uppercase tracking-wider">
            <AlertTriangle className="w-3 h-3" />
            Trust Boundary Crossed
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[10px] text-fg-disabled uppercase tracking-wider font-medium mb-2">Affected Services</p>
          <div className="flex flex-wrap gap-1.5">
            {affectedServices.map((service, i) => (
              <span
                key={service}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-elevated text-[11px] text-fg-primary"
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', serviceColors[i % serviceColors.length])} />
                {service}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] text-fg-disabled uppercase tracking-wider font-medium mb-2">Affected User Journeys</p>
          <div className="flex flex-wrap gap-1.5">
            {affectedUserJourneys.map((journey) => (
              <span
                key={journey}
                className="px-2 py-0.5 rounded-md bg-surface-elevated text-[11px] text-fg-primary"
              >
                {journey}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] text-fg-disabled uppercase tracking-wider font-medium mb-2">Downstream Failure Path</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {pathSegments.map((segment, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="px-2.5 py-1 rounded-md bg-surface-elevated border border-border-subtle text-[11px] text-fg-primary font-mono">
                  {segment}
                </span>
                {i < pathSegments.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-fg-disabled shrink-0" />
                )}
              </span>
            ))}
          </div>
        </div>

        {trustBoundaryCrossed && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-intent-critical/5 border border-intent-critical/20">
            <Shield className="w-3.5 h-3.5 text-intent-critical shrink-0" />
            <p className="text-[11px] text-fg-muted">
              This finding crosses a trust boundary. Review requires security team approval.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
