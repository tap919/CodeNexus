import { FileSearch } from 'lucide-react';

export default function ReviewPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-lg font-semibold text-fg-primary tracking-tight">Review Workspace</h1>
      <p className="text-xs text-fg-muted mt-1">Inspect findings, code, evidence, and blind spots.</p>
      <div className="mt-8 p-8 rounded-xl bg-surface border border-border-subtle text-center">
        <FileSearch className="w-8 h-8 text-fg-disabled mx-auto mb-3" />
        <p className="text-sm text-fg-muted">Select a session from Home or Sessions to begin reviewing.</p>
      </div>
    </div>
  );
}
