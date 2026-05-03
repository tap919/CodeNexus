'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { Pipeline } from '@/components/dashboard/pipeline';
import { UploadWidget } from '@/components/dashboard/upload-widget';
import { StatsRow } from '@/components/dashboard/stats-cards';
import { OverviewTab } from '@/components/dashboard/overview-tab';

export default function DashboardPage() {
  const [activeView, setActiveView] = useState('overview');
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-base-900">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-base-700/50 bg-base-850/60 backdrop-blur-xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">Repo</span>
              <span className="text-sm font-medium text-text-primary font-mono">
                {selectedRepo || 'Select a repository'}
              </span>
            </div>
            {selectedRepo && (
              <span className="tag-blue">Active</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="font-mono">v0.2.0</span>
              <span className="w-1 h-1 rounded-full bg-base-600" />
              <span>3 agents</span>
              <span className="w-1 h-1 rounded-full bg-base-600" />
              <span>Last updated: just now</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6 space-y-6">
            {/* Upload / Repo selector */}
            <div className="animate-slide-up">
              <UploadWidget onRepoSelect={setSelectedRepo} />
            </div>

            {selectedRepo && (
              <>
                {/* Stats row */}
                <StatsRow />

                {/* Pipeline + Alerts */}
                <div className="grid grid-cols-5 gap-6">
                  {/* Pipeline - 3 cols */}
                  <div className="col-span-3">
                    <Pipeline />
                  </div>

                  {/* Overview - 2 cols */}
                  <div className="col-span-2">
                    <div className="glass-panel p-5 h-full">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Quick Insight</h3>
                        <span className="tag-purple text-[10px]">AI Analysis</span>
                      </div>

                      <div className="space-y-4">
                        <div className="p-4 rounded-xl bg-base-800/50 border border-base-700/30">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="status-dot warning" />
                            <span className="text-xs font-medium text-accent-amber">Consequence Rail</span>
                          </div>
                          <p className="text-sm text-text-secondary leading-relaxed">
                            Changes to <span className="text-accent-blue font-mono text-xs">shared/src/types.ts</span> will
                            trigger rebuilds in <span className="font-semibold text-text-primary">7 downstream packages</span>.
                          </p>
                          <div className="flex items-center gap-3 mt-3 text-[11px]">
                            <span className="flex items-center gap-1 text-accent-amber">
                              <span>⚠</span> +23% blast radius
                            </span>
                            <span className="flex items-center gap-1 text-accent-cyan">
                              <span>◈</span> 2 traces verified
                            </span>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-base-800/50 border border-base-700/30">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="status-dot online" />
                            <span className="text-xs font-medium text-accent-green">Confidence Assessment</span>
                          </div>
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-text-muted">Auth fixes</span>
                              <span className="font-medium text-accent-green">High · 0.89</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-text-muted">Security patches</span>
                              <span className="font-medium text-accent-blue">Medium · 0.72</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-text-muted">Knowledge parser</span>
                              <span className="font-medium text-accent-amber">Low · 0.45</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button className="flex-1 py-2 rounded-lg bg-accent-green/15 text-accent-green text-xs font-medium border border-accent-green/20 hover:bg-accent-green/20 transition-all">
                            ✓ Approve & Fix
                          </button>
                          <button className="flex-1 py-2 rounded-lg bg-accent-blue/15 text-accent-blue text-xs font-medium border border-accent-blue/20 hover:bg-accent-blue/20 transition-all">
                            ⬆ Escalate
                          </button>
                          <button className="flex-1 py-2 rounded-lg bg-base-800 text-text-muted text-xs font-medium border border-base-600/30 hover:border-accent-red/30 hover:text-accent-red transition-all">
                            ✕ Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full overview tab */}
                <OverviewTab />
              </>
            )}

            {!selectedRepo && (
              <div className="flex flex-col items-center justify-center py-20 text-center animate-scale-in">
                <div className="w-20 h-20 rounded-2xl bg-base-800/50 border border-base-600/30 flex items-center justify-center mb-6 animate-float">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-text-muted">
                    <path d="M21 16V8a2 2 0 00-1-1.73L13 2.27a2 2 0 00-2 0L4 6.27A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" strokeLinecap="round" strokeLinejoin="round"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="22.08" x2="12" y2="12" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-text-primary mb-1">Start a new review</h3>
                <p className="text-sm text-text-muted max-w-sm">
                  Enter a GitHub repository URL above or drop a local project folder to begin code analysis
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
