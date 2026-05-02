'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { useWebSocket } from '@/providers/ws-provider';
import {
  Activity, GitPullRequest, AlertTriangle, CheckCircle2,
  Clock, XCircle, ChevronRight, Play, Pause,
} from 'lucide-react';

type SessionStatus = 'running' | 'completed' | 'failed' | 'queued' | 'blocked';

interface Session {
  id: string;
  repo: string;
  branch: string;
  prNumber: number;
  currentStep: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  status: SessionStatus;
  lastEvent: string;
  stepProgress: number;
  totalSteps: number;
}

const MOCK_SESSIONS: Session[] = [
  { id: 'ses_abc123', repo: 'codenexus/auth-service', branch: 'fix/jwt-algorithm', prNumber: 142, currentStep: 'Analyzing codebase', riskLevel: 'critical', status: 'running', lastEvent: new Date(Date.now() - 30000).toISOString(), stepProgress: 4, totalSteps: 15 },
  { id: 'ses_def456', repo: 'codenexus/security', branch: 'fix/prompt-injection', prNumber: 138, currentStep: 'Running security scan', riskLevel: 'high', status: 'running', lastEvent: new Date(Date.now() - 60000).toISOString(), stepProgress: 7, totalSteps: 15 },
  { id: 'ses_ghi789', repo: 'codenexus/cli-generator', branch: 'fix/path-traversal', prNumber: 140, currentStep: 'Applying fixes', riskLevel: 'medium', status: 'running', lastEvent: new Date(Date.now() - 120000).toISOString(), stepProgress: 10, totalSteps: 15 },
  { id: 'ses_jkl012', repo: 'codenexus/analytics', branch: 'feat/e2e-tests', prNumber: 145, currentStep: 'Awaiting sandbox', riskLevel: 'low', status: 'queued', lastEvent: new Date(Date.now() - 300000).toISOString(), stepProgress: 0, totalSteps: 15 },
  { id: 'ses_mno345', repo: 'codenexus/knowledge', branch: 'fix/path-traversal', prNumber: 135, currentStep: 'Complete', riskLevel: 'low', status: 'completed', lastEvent: new Date(Date.now() - 3600000).toISOString(), stepProgress: 15, totalSteps: 15 },
  { id: 'ses_pqr678', repo: 'codenexus/pr-manager', branch: 'fix/api-post-body', prNumber: 137, currentStep: 'Step 8 failed: Timeout', riskLevel: 'high', status: 'failed', lastEvent: new Date(Date.now() - 7200000).toISOString(), stepProgress: 8, totalSteps: 15 },
];

const statusConfig: Record<SessionStatus, { icon: typeof Activity; color: string; label: string; bg: string }> = {
  running: { icon: Play, color: 'text-intent-action', label: 'Running', bg: 'bg-intent-action/10' },
  completed: { icon: CheckCircle2, color: 'text-intent-success', label: 'Completed', bg: 'bg-intent-success/10' },
  failed: { icon: XCircle, color: 'text-intent-critical', label: 'Failed', bg: 'bg-intent-critical/10' },
  queued: { icon: Clock, color: 'text-intent-warning', label: 'Queued', bg: 'bg-intent-warning/10' },
  blocked: { icon: AlertTriangle, color: 'text-intent-critical', label: 'Blocked', bg: 'bg-intent-critical/10' },
};

const riskConfig = {
  critical: 'border-l-intent-critical',
  high: 'border-l-intent-warning',
  medium: 'border-l-intent-evidence',
  low: 'border-l-fg-muted',
};

function SessionRow({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);
  const s = statusConfig[session.status];
  const progress = Math.round((session.stepProgress / session.totalSteps) * 100);

  return (
    <>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors text-left border-l-2',
          riskConfig[session.riskLevel],
        )}
      >
        <s.icon className={cn('w-4 h-4 shrink-0', s.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs text-fg-primary font-medium truncate">{session.repo}</p>
            <span className="text-[10px] text-fg-disabled bg-surface-elevated px-1.5 py-0.5 rounded">
              PR #{session.prNumber}
            </span>
          </div>
          <p className="text-[11px] text-fg-muted truncate">{session.currentStep}</p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <div className="w-20 bg-surface-elevated rounded-full h-1.5 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', s.color.replace('text-', 'bg-'))}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-fg-muted w-8">{progress}%</span>
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded', s.bg, s.color)}>{s.label}</span>
        <ChevronRight className={cn('w-3.5 h-3.5 text-fg-muted transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-surface-elevated/50 border-l-2 border-transparent ml-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-fg-disabled uppercase">Branch</span>
              <p className="text-xs text-fg-primary font-mono">{session.branch}</p>
            </div>
            <div>
              <span className="text-[10px] text-fg-disabled uppercase">Session ID</span>
              <p className="text-xs text-fg-primary font-mono">{session.id}</p>
            </div>
            <div>
              <span className="text-[10px] text-fg-disabled uppercase">Risk Level</span>
              <p className="text-xs text-fg-primary capitalize">{session.riskLevel}</p>
            </div>
            <div>
              <span className="text-[10px] text-fg-disabled uppercase">Last Event</span>
              <p className="text-xs text-fg-primary">{formatRelativeTime(session.lastEvent)}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button className="text-[11px] px-3 py-1 rounded bg-intent-action/15 text-intent-action hover:bg-intent-action/25 transition-colors">
              View Details
            </button>
            {session.status === 'running' && (
              <button className="text-[11px] px-3 py-1 rounded bg-intent-critical/15 text-intent-critical hover:bg-intent-critical/25 transition-colors">
                Cancel
              </button>
            )}
            {session.status === 'failed' && (
              <button className="text-[11px] px-3 py-1 rounded bg-intent-warning/15 text-intent-warning hover:bg-intent-warning/25 transition-colors">
                Retry
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function SessionsPage() {
  const { connected } = useWebSocket();

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary tracking-tight">Sessions</h1>
          <p className="text-xs text-fg-muted mt-0.5">Live review runs and agent progress</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-intent-success' : 'bg-intent-warning')} />
          <span className="text-[11px] text-fg-muted">{connected ? 'Live' : 'Reconnecting'}</span>
        </div>
      </div>

      <div className="rounded-xl bg-surface border border-border-subtle overflow-hidden divide-y divide-border-subtle">
        <div className="px-4 py-2 bg-surface-elevated flex items-center gap-3 text-[10px] uppercase tracking-wider text-fg-disabled">
          <span className="w-4" />
          <span className="flex-1">Session</span>
          <span className="hidden sm:block w-28 text-right">Progress</span>
          <span className="w-20 text-right">Status</span>
          <span className="w-4" />
        </div>
        {MOCK_SESSIONS.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}
