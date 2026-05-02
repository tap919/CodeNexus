'use client';

import { cn } from '@/lib/utils';
import {
  GitBranch,
  Camera,
  FileText,
  Wifi,
  BookOpen,
} from 'lucide-react';

interface ArtifactTabsProps {
  traceAvailable: boolean;
  screenshotAvailable: boolean;
  logsAvailable: boolean;
  networkAvailable: boolean;
  reviewLinkAvailable: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { key: 'trace', label: 'Trace', icon: GitBranch, availableKey: 'traceAvailable' as const },
  { key: 'screenshot', label: 'Screenshot', icon: Camera, availableKey: 'screenshotAvailable' as const },
  { key: 'logs', label: 'Logs', icon: FileText, availableKey: 'logsAvailable' as const },
  { key: 'network', label: 'Network', icon: Wifi, availableKey: 'networkAvailable' as const },
  { key: 'review', label: 'Review', icon: BookOpen, availableKey: 'reviewLinkAvailable' as const },
];

export function ArtifactTabs({
  traceAvailable,
  screenshotAvailable,
  logsAvailable,
  networkAvailable,
  reviewLinkAvailable,
  activeTab,
  onTabChange,
}: ArtifactTabsProps) {
  const availability: Record<string, boolean> = {
    traceAvailable,
    screenshotAvailable,
    logsAvailable,
    networkAvailable,
    reviewLinkAvailable,
  };

  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-border-subtle">
      {TABS.map((tab) => {
        const isAvailable = availability[tab.availableKey];
        const isActive = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            onClick={() => isAvailable && onTabChange(tab.key)}
            disabled={!isAvailable}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all',
              isActive && isAvailable && 'bg-surface-elevated text-fg-primary shadow-sm',
              !isActive && isAvailable && 'text-fg-muted hover:text-fg-primary hover:bg-surface-elevated/50',
              !isAvailable && 'text-fg-disabled cursor-not-allowed'
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
