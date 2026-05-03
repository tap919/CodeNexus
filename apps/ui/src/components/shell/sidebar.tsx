'use client';

import { useState } from 'react';

interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  active?: boolean;
}

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: '◉' },
  { id: 'pipeline', label: 'Pipeline', icon: '⇢', badge: 3 },
  { id: 'review', label: 'Code Review', icon: '◎', badge: 24 },
  { id: 'security', label: 'Security', icon: '⬡', badge: 5 },
  { id: 'knowledge', label: 'Knowledge', icon: '▣' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside className="w-56 h-screen flex flex-col border-r border-base-700/50 bg-base-850/80 backdrop-blur-xl select-none">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center shadow-lg glow-blue">
            <span className="text-white text-sm font-bold">C</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary tracking-tight">CodeNexus</h1>
            <p className="text-[10px] text-text-muted tracking-wider uppercase">Enterprise</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
              ${activeView === item.id
                ? 'bg-base-700/50 text-text-primary border border-base-600/30 shadow-inner'
                : 'text-text-secondary hover:text-text-primary hover:bg-base-700/20 border border-transparent'
              }
            `}
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <span className={`
                px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none
                ${activeView === item.id
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'bg-base-700 text-text-muted'
                }
              `}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Bottom status */}
      <div className="px-5 py-4 border-t border-base-700/50">
        <div className="flex items-center gap-2.5 text-xs text-text-secondary">
          <span className="status-dot online" />
          <span>System Online</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-text-muted">
          <span className="font-mono">v0.2.0</span>
          <span className="w-1 h-1 rounded-full bg-base-600" />
          <span>3 agents active</span>
        </div>
      </div>
    </aside>
  );
}
