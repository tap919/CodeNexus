'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useUIStore, type ReviewMode } from '@/stores/ui-store';
import {
  Home, GitPullRequest, AlertTriangle, Play, BookOpen,
  Shield, Settings, Activity, FileSearch,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/sessions', label: 'Sessions', icon: Activity },
  { href: '/review', label: 'Review', icon: FileSearch },
  { href: '/decisions', label: 'Decisions', icon: AlertTriangle },
  { href: '/runtime', label: 'Runtime', icon: Play },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/governance', label: 'Governance', icon: Shield },
];

const MODES: { key: ReviewMode; label: string; color: string }[] = [
  { key: 'vibe', label: 'Vibe', color: 'bg-intent-warning' },
  { key: 'engineer', label: 'Eng', color: 'bg-intent-action' },
  { key: 'security', label: 'Sec', color: 'bg-intent-critical' },
];

export function LeftRail() {
  const pathname = usePathname();
  const { mode, setMode } = useUIStore();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="h-full flex flex-col bg-surface border-r border-border-subtle py-2 select-none">
      <div className="flex-1 flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors group',
                active
                  ? 'bg-surface-elevated text-fg-primary'
                  : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-elevated/50',
              )}
            >
              <item.icon className={cn('w-4 h-4 shrink-0', active && 'text-intent-action')} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="px-3 py-2 border-t border-border-subtle">
        <p className="text-[10px] uppercase tracking-widest text-fg-disabled mb-2">Mode</p>
        <div className="flex flex-col gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors',
                mode === m.key
                  ? 'bg-surface-elevated text-fg-primary'
                  : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', mode === m.key ? m.color : 'bg-border-default')} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-border-subtle">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-fg-muted hover:text-fg-secondary hover:bg-surface-elevated/50 transition-colors',
            pathname === '/settings' && 'bg-surface-elevated text-fg-primary',
          )}
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>
      </div>
    </nav>
  );
}
