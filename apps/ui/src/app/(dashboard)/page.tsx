'use client';

import { useState, useCallback, useRef, type DragEvent } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { Pipeline } from '@/components/dashboard/pipeline';
import { StatsRow } from '@/components/dashboard/stats-cards';
import { OverviewTab } from '@/components/dashboard/overview-tab';

type ReviewState = 'idle' | 'loading' | 'ready';

export default function DashboardPage() {
  const [activeView, setActiveView] = useState('overview');
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>('idle');
  const [inputMode, setInputMode] = useState<'url' | 'local'>('url');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const name = files[0].name || 'Local Project';
      setSelectedRepo(name);
      setReviewState('ready');
    }
  }, []);

  const handleBeginReview = () => {
    if (!selectedRepo) return;
    setReviewState('loading');
    setTimeout(() => setReviewState('ready'), 1800);
  };

  const handleRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (repoUrl.trim()) {
      setSelectedRepo(repoUrl.trim());
      setReviewState('ready');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedRepo(files[0].name || 'Local Project');
      setReviewState('ready');
    }
  };

  return (
    <div className="flex h-screen bg-base-900 overflow-hidden">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-base-700/50 bg-base-850/60 backdrop-blur-xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-secondary">Repo</span>
            <span className="text-sm font-medium text-text-primary font-mono">
              {selectedRepo || 'Select a repository'}
            </span>
            {selectedRepo && <span className="tag tag-blue">Active</span>}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="font-mono">v0.2.0</span>
              <span className="w-1 h-1 rounded-full bg-base-600" />
              <span>3 agents</span>
            </div>
            {selectedRepo && reviewState !== 'loading' && (
              <button
                onClick={handleBeginReview}
                className="btn-primary px-5 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer"
              >
                Begin Review
              </button>
            )}
            {reviewState === 'loading' && (
              <div className="flex items-center gap-2 px-5 py-2 rounded-lg bg-base-700/60 border border-base-600/50 text-sm text-text-secondary">
                <span className="w-3 h-3 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
                Analyzing...
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!selectedRepo ? (
            /* Landing / Upload screen */
            <div className="flex flex-col items-center justify-center min-h-full px-8 py-16">
              {/* Hero */}
              <div className="text-center mb-12 animate-slide-up">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-blue/10 border border-accent-blue/20 text-xs text-accent-blue font-medium mb-4">
                  <span className="status-dot online" />
                  AI-Native Code Review
                </div>
                <h1 className="text-4xl font-bold text-text-primary mb-3 tracking-tight">
                  Code<span className="neon-text-cyan">Nexus</span>
                </h1>
                <p className="text-base text-text-secondary max-w-md">
                  Agentic code review, security scanning, and automated fixes — in one pipeline.
                </p>
              </div>

              {/* Input toggle */}
              <div className="w-full max-w-2xl animate-slide-up">
                <div className="flex rounded-xl bg-base-800 border border-base-600/50 p-1 mb-4 w-fit mx-auto">
                  <button
                    onClick={() => setInputMode('url')}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                      inputMode === 'url'
                        ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    GitHub URL
                  </button>
                  <button
                    onClick={() => setInputMode('local')}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                      inputMode === 'local'
                        ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    Local Folder
                  </button>
                </div>

                {inputMode === 'url' ? (
                  <form onSubmit={handleRepoSubmit} className="flex gap-3">
                    <div className="flex-1 relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="github.com/owner/repo"
                        className="w-full pl-10 pr-4 py-3.5 bg-base-800 border border-base-600/50 rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue/60 focus:outline-none focus:ring-2 focus:ring-accent-blue/15 transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!repoUrl.trim()}
                      className="btn-primary px-8 py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Analyze
                    </button>
                  </form>
                ) : (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                    className={`upload-zone flex flex-col items-center justify-center gap-4 py-16 px-8 cursor-pointer transition-all ${
                      dragOver ? 'drag-over' : ''
                    }`}
                  >
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${
                      dragOver ? 'bg-accent-blue/20' : 'bg-base-700/60'
                    }`}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#4dabf7' : '#6b6b80'} strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-medium text-text-primary mb-1">
                        {dragOver ? 'Drop to begin analysis' : 'Drop your project folder here'}
                      </p>
                      <p className="text-sm text-text-muted">
                        or <span className="text-accent-blue cursor-pointer">browse files</span> — supports .zip, .tar, or folder
                      </p>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      // @ts-ignore
                      webkitdirectory=""
                      multiple
                      onChange={handleFileChange}
                    />
                  </div>
                )}

                {/* Feature highlights */}
                <div className="grid grid-cols-3 gap-3 mt-8">
                  {[
                    { icon: '🔍', label: 'Security Scan', desc: 'Secrets, SAST, supply chain' },
                    { icon: '🤖', label: 'AI Review', desc: 'GPT-4o · 3 passes' },
                    { icon: '⚡', label: 'Auto-Fix', desc: 'Test · Lint · Build · Push' },
                  ].map((f) => (
                    <div key={f.label} className="skeuo-card p-4 flex flex-col gap-2">
                      <span className="text-xl">{f.icon}</span>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{f.label}</p>
                        <p className="text-xs text-text-muted mt-0.5">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6 animate-slide-up">
              <StatsRow />
              <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2">
                  <Pipeline />
                </div>
                <div className="col-span-1 space-y-4">
                  {/* Quick Insight */}
                  <div className="skeuo-card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-text-primary">Quick Insight</span>
                      <span className="tag tag-cyan">AI Analysis</span>
                    </div>
                    <div className="space-y-3 text-xs text-text-secondary">
                      <p>Changes to <code className="text-accent-blue bg-accent-blue/10 px-1 rounded">shared/src/types.ts</code> will trigger rebuilds in <strong className="text-text-primary">7 downstream packages</strong>.</p>
                      <div className="flex items-center gap-2">
                        <span className="tag tag-amber">⚠ +23% blast radius</span>
                        <span className="tag tag-blue">◈ 2 traces verified</span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button className="flex-1 btn-primary py-2 rounded-lg text-xs font-semibold text-white">✓ Approve</button>
                      <button className="flex-1 py-2 rounded-lg text-xs font-semibold text-text-muted bg-base-700/60 border border-base-600/50 hover:bg-base-700 transition-all">✕ Reject</button>
                    </div>
                  </div>
                </div>
              </div>
              <OverviewTab />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
