'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Activity, ExternalLink } from 'lucide-react';

interface RelatedIncident {
  id: string;
  title: string;
  similarity: number;
  date: string;
  status: 'resolved' | 'open' | 'monitoring';
}

interface RelatedIncidentsPanelProps {
  incidents: RelatedIncident[];
}

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  resolved: { icon: CheckCircle2, color: 'text-intent-success bg-intent-success/10', label: 'Resolved' },
  open: { icon: AlertTriangle, color: 'text-intent-critical bg-intent-critical/10', label: 'Open' },
  monitoring: { icon: Activity, color: 'text-intent-warning bg-intent-warning/10', label: 'Monitoring' },
};

export function RelatedIncidentsPanel({ incidents }: RelatedIncidentsPanelProps) {
  if (incidents.length === 0) return null;

  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle">
      <h3 className="text-xs font-medium text-fg-primary uppercase tracking-wider mb-3">
        Related Incidents
      </h3>
      <div className="space-y-2">
        {incidents.map((incident) => {
          const status = statusConfig[incident.status];
          const StatusIcon = status.icon;
          return (
            <div
              key={incident.id}
              className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-elevated transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm text-fg-primary truncate">{incident.title}</span>
                  <ExternalLink className="w-3 h-3 text-fg-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1',
                    status.color
                  )}>
                    <StatusIcon className="w-2.5 h-2.5" />
                    {status.label}
                  </span>
                  <span className="text-[10px] text-fg-disabled">{formatRelativeTime(incident.date)}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className={cn(
                  'text-sm font-semibold font-mono',
                  incident.similarity >= 80 ? 'text-intent-critical' :
                  incident.similarity >= 60 ? 'text-intent-warning' :
                  'text-fg-muted'
                )}>
                  {incident.similarity}%
                </span>
                <span className="block text-[10px] text-fg-disabled">match</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
