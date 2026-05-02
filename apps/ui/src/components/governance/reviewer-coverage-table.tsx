'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Shield, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

export interface ReviewerCoverage {
  path: string;
  requiredOwner: string;
  assignedReviewers: string[];
  coverageStatus: 'covered' | 'partial' | 'uncovered';
  lastReviewed: string;
}

interface ReviewerCoverageTableProps {
  paths: ReviewerCoverage[];
}

const coverageConfig = {
  covered: {
    icon: CheckCircle2,
    text: 'text-intent-success',
    bg: 'bg-intent-success/10',
    label: 'Covered',
  },
  partial: {
    icon: AlertCircle,
    text: 'text-intent-warning',
    bg: 'bg-intent-warning/10',
    label: 'Partial',
  },
  uncovered: {
    icon: XCircle,
    text: 'text-intent-critical',
    bg: 'bg-intent-critical/10',
    label: 'Uncovered',
  },
};

const SENSITIVE_KEYWORDS = ['auth', 'security', 'config', 'secrets', 'token', 'credential'];

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

export function ReviewerCoverageTable({ paths }: ReviewerCoverageTableProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Reviewer Coverage</h3>
      <div className="rounded-xl border border-border-subtle overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-elevated">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Path
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Required Owner
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Assigned Reviewers
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Last Reviewed
              </th>
            </tr>
          </thead>
          <tbody>
            {paths.map((item, i) => {
              const cfg = coverageConfig[item.coverageStatus];
              const Icon = cfg.icon;
              const sensitive = isSensitivePath(item.path);

              return (
                <tr
                  key={item.path}
                  className={cn(
                    'transition-colors',
                    i % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated/30',
                    sensitive && 'border-l-2 border-l-intent-critical'
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {sensitive && (
                        <Shield className="w-3.5 h-3.5 text-intent-critical shrink-0" />
                      )}
                      <span
                        className={cn(
                          'text-[11px] font-mono',
                          sensitive ? 'text-intent-critical font-semibold' : 'text-fg-primary'
                        )}
                      >
                        {item.path}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-fg-muted">
                    {item.requiredOwner}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {item.assignedReviewers.length > 0 ? (
                        item.assignedReviewers.map((r) => (
                          <span
                            key={r}
                            className="px-1.5 py-0.5 rounded bg-surface-elevated text-[10px] text-fg-muted font-mono"
                          >
                            {r}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-fg-disabled italic">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase w-fit',
                        cfg.bg,
                        cfg.text
                      )}
                    >
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-fg-muted">
                    {formatRelativeTime(item.lastReviewed)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
