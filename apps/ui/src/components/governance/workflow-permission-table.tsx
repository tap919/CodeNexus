'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Key,
  Unlock,
} from 'lucide-react';

export interface WorkflowPerm {
  workflow: string;
  fileName: string;
  tokenScope: string;
  untrustedInput: boolean;
  pinnedActions: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'pass' | 'fail' | 'warn';
}

interface WorkflowPermissionTableProps {
  workflows: WorkflowPerm[];
}

const severityConfig = {
  critical: { bg: 'bg-intent-critical/10', text: 'text-intent-critical', label: 'Critical' },
  high: { bg: 'bg-intent-warning/10', text: 'text-intent-warning', label: 'High' },
  medium: { bg: 'bg-intent-evidence/10', text: 'text-intent-evidence', label: 'Medium' },
  low: { bg: 'bg-surface-elevated', text: 'text-fg-muted', label: 'Low' },
};

const statusConfig = {
  pass: { icon: CheckCircle2, text: 'text-intent-success', bg: 'bg-intent-success/10', label: 'Pass' },
  fail: { icon: XCircle, text: 'text-intent-critical', bg: 'bg-intent-critical/10', label: 'Fail' },
  warn: { icon: AlertTriangle, text: 'text-intent-warning', bg: 'bg-intent-warning/10', label: 'Warn' },
};

export function WorkflowPermissionTable({ workflows }: WorkflowPermissionTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary tracking-tight">Workflow Permissions</h3>
      <div className="rounded-xl border border-border-subtle overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-elevated">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Workflow
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                File
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Token Scope
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Untrusted Input
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Pinned Actions
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Severity
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((wf, i) => {
              const sev = severityConfig[wf.severity];
              const st = statusConfig[wf.status];
              const StatusIcon = st.icon;
              const isExpanded = expanded === wf.workflow;

              return (
                <tr key={wf.workflow}>
                  <td colSpan={7} className="p-0">
                    <button
                      className={cn(
                        'w-full cursor-pointer hover:bg-surface-elevated/50 transition-colors',
                        i % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated/30'
                      )}
                      onClick={() => setExpanded(isExpanded ? null : wf.workflow)}
                      aria-expanded={isExpanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpanded(isExpanded ? null : wf.workflow);
                        }
                      }}
                    >
                      <table className="w-full">
                        <tbody>
                          <tr>
                            <td className="px-4 py-3 text-[11px] text-fg-primary font-medium w-[20%]">
                              <div className="flex items-center gap-1.5">
                                {isExpanded ? (
                                  <ChevronDown className="w-3 h-3 text-fg-muted" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-fg-muted" aria-hidden="true" />
                                )}
                                {wf.workflow}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[11px] text-fg-muted font-mono w-[18%]">
                              {wf.fileName}
                            </td>
                            <td className="px-4 py-3 w-[18%]">
                              <div className="flex items-center gap-1">
                                {wf.tokenScope === 'write-all' ? (
                                  <Unlock className="w-3 h-3 text-intent-critical" />
                                ) : (
                                  <Key className="w-3 h-3 text-intent-success" />
                                )}
                                <span
                                  className={cn(
                                    'text-[11px] font-mono',
                                    wf.tokenScope === 'write-all'
                                      ? 'text-intent-critical'
                                      : 'text-fg-muted'
                                  )}
                                >
                                  {wf.tokenScope}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 w-[12%]">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded text-[10px] font-medium',
                                  wf.untrustedInput
                                    ? 'bg-intent-critical/10 text-intent-critical'
                                    : 'bg-intent-success/10 text-intent-success'
                                )}
                              >
                                {wf.untrustedInput ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-4 py-3 w-[12%]">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded text-[10px] font-medium',
                                  wf.pinnedActions
                                    ? 'bg-intent-success/10 text-intent-success'
                                    : 'bg-intent-warning/10 text-intent-warning'
                                )}
                              >
                                {wf.pinnedActions ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-4 py-3 w-[10%]">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded text-[10px] font-semibold uppercase',
                                  sev.bg,
                                  sev.text
                                )}
                              >
                                {sev.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 w-[10%]">
                              <span
                                className={cn(
                                  'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase',
                                  st.bg,
                                  st.text
                                )}
                              >
                                <StatusIcon className="w-3 h-3" />
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </button>

                    {isExpanded && (
                      <div
                        className={cn(
                          'px-4 py-3 border-t border-border-subtle',
                          i % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated/30'
                        )}
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          <Shield className="w-3.5 h-3.5 text-fg-muted" />
                          <span className="text-[10px] font-semibold text-fg-disabled uppercase tracking-wider">
                            Details
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-[11px]">
                          <div>
                            <span className="text-fg-disabled">Token Scope: </span>
                            <span className="text-fg-primary font-mono">{wf.tokenScope}</span>
                          </div>
                          <div>
                            <span className="text-fg-disabled">Untrusted Input: </span>
                            <span
                              className={cn(
                                'font-medium',
                                wf.untrustedInput ? 'text-intent-critical' : 'text-intent-success'
                              )}
                            >
                              {wf.untrustedInput ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div>
                            <span className="text-fg-disabled">Pinned Actions: </span>
                            <span
                              className={cn(
                                'font-medium',
                                wf.pinnedActions ? 'text-intent-success' : 'text-intent-warning'
                              )}
                            >
                              {wf.pinnedActions ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div>
                            <span className="text-fg-disabled">File: </span>
                            <span className="text-fg-primary font-mono">{wf.fileName}</span>
                          </div>
                        </div>
                      </div>
                    )}
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
