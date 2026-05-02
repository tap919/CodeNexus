'use client';

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/ui-store';
import {
  Home, Activity, FileSearch, AlertTriangle, Play,
  BookOpen, Shield, Search,
} from 'lucide-react';

const PAGES = [
  { id: 'home', label: 'Home', icon: Home, href: '/' },
  { id: 'sessions', label: 'Sessions', icon: Activity, href: '/sessions' },
  { id: 'review', label: 'Review Workspace', icon: FileSearch, href: '/review' },
  { id: 'decisions', label: 'Decision Center', icon: AlertTriangle, href: '/decisions' },
  { id: 'runtime', label: 'Runtime Lab', icon: Play, href: '/runtime' },
  { id: 'knowledge', label: 'Knowledge Hub', icon: BookOpen, href: '/knowledge' },
  { id: 'governance', label: 'Governance Console', icon: Shield, href: '/governance' },
];

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  return (
    <Command.Dialog
      open={commandPaletteOpen}
      onOpenChange={setCommandPaletteOpen}
      label="CodeNexus Command Palette"
      className="fixed inset-0 z-50"
    >
      <div className="fixed inset-0 bg-black/60" />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-surface border border-border-subtle rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Search className="w-4 h-4 text-fg-muted" />
          <Command.Input
            placeholder="Jump to a page, PR, finding, or trace..."
            className="w-full bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-disabled"
          />
        </div>
        <Command.List className="max-h-64 overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-fg-muted">
            No results found.
          </Command.Empty>
          <Command.Group heading="Navigate" className="text-[10px] uppercase tracking-widest text-fg-disabled px-2 py-1">
            {PAGES.map((page) => (
              <Command.Item
                key={page.id}
                value={page.label}
                onSelect={() => {
                  router.push(page.href);
                  setCommandPaletteOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fg-primary hover:bg-surface-elevated cursor-pointer data-[selected=true]:bg-surface-elevated"
              >
                <page.icon className="w-4 h-4 text-fg-muted" />
                {page.label}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
