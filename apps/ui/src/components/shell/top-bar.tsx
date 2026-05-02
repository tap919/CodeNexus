'use client';

import { useWorkspaceStore } from '@/stores/workspace-store';
import { useUIStore } from '@/stores/ui-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { cn } from '@/lib/utils';
import { Activity, Wifi, WifiOff, Search, PanelLeft, PanelRight, ChevronDown } from 'lucide-react';

export function TopBar() {
  const { repository, branch, prNumber, environment, userRole } = useWorkspaceStore();
  const { mode, toggleLeftPanel, toggleRightPanel, setCommandPaletteOpen, leftPanelOpen, rightPanelOpen } = useUIStore();
  const { connectionStatus } = useDashboardStore();

  return (
    <header className="h-11 shrink-0 border-b border-border-subtle bg-surface flex items-center px-3 gap-2 select-none">
      <button
        type="button"
        onClick={toggleLeftPanel}
        aria-label="Toggle left panel"
        className={cn('p-1.5 rounded hover:bg-surface-elevated transition-colors', leftPanelOpen && 'text-intent-action')}
      >
        <PanelLeft className="w-4 h-4" />
      </button>

      <div className="h-4 w-px bg-border-subtle mx-1" />

      <span className="text-sm font-medium text-fg-primary tracking-tight">CodeNexus</span>

      <div className="h-4 w-px bg-border-subtle mx-1" />

      <button type="button" className="flex items-center gap-1 px-2 py-1 rounded text-xs text-fg-muted hover:bg-surface-elevated transition-colors">
        <span>{repository || 'select repo'}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {branch && (
        <>
          <span className="text-border-default text-xs">/</span>
          <span className="text-xs text-fg-muted">{branch}</span>
        </>
      )}

      {prNumber && (
        <span className="text-xs bg-surface-elevated px-2 py-0.5 rounded text-fg-secondary">PR #{prNumber}</span>
      )}

      <div className="flex-1" />

      <span className="text-[10px] uppercase tracking-widest text-fg-disabled bg-surface-elevated px-2 py-0.5 rounded">
        {environment}
      </span>

      <div className="h-4 w-px bg-border-subtle" />

      <span className={cn(
        'text-[10px] uppercase tracking-widest px-2 py-0.5 rounded',
        mode === 'vibe' && 'bg-intent-warning/15 text-intent-warning',
        mode === 'engineer' && 'bg-intent-action/15 text-intent-action',
        mode === 'security' && 'bg-intent-critical/15 text-intent-critical',
      )}>
        {mode}
      </span>

      <div className="h-4 w-px bg-border-subtle" />

      <span className="text-xs text-fg-muted">{userRole}</span>

      <div className="h-4 w-px bg-border-subtle" />

      {connectionStatus === 'connected' ? (
        <Wifi className="w-3.5 h-3.5 text-intent-success" />
      ) : (
        <WifiOff className="w-3.5 h-3.5 text-intent-warning" />
      )}

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        aria-label="Open command palette (Cmd+K)"
        className="ml-1 flex items-center gap-2 px-2 py-1 rounded text-xs text-fg-muted bg-surface-elevated hover:bg-surface-overlay border border-border-subtle transition-colors"
      >
        <Search className="w-3 h-3" />
        <span className="hidden sm:inline">Cmd+K</span>
      </button>

      <button
        type="button"
        onClick={toggleRightPanel}
        aria-label="Toggle right panel"
        className={cn('p-1.5 rounded hover:bg-surface-elevated transition-colors', rightPanelOpen && 'text-intent-action')}
      >
        <PanelRight className="w-4 h-4" />
      </button>
    </header>
  );
}
