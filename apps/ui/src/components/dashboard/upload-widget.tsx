'use client';

import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';

interface UploadWidgetProps {
  onRepoSelect: (url: string) => void;
}

export function UploadWidget({ onRepoSelect }: UploadWidgetProps) {
  const [dragOver, setDragOver] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // In a real app, upload to server
      console.log('Dropped files:', Array.from(files).map(f => f.name));
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      console.log('Selected files:', Array.from(files).map(f => f.name));
    }
  };

  const handleRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (repoUrl.trim()) {
      onRepoSelect(repoUrl.trim());
    }
  };

  return (
    <div className="space-y-4">
      {/* Repo URL input */}
      <form onSubmit={handleRepoSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="github.com/owner/repo or paste repo URL..."
            className="w-full px-4 py-2.5 bg-base-800 border border-base-600/50 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue/50 focus:outline-none focus:ring-1 focus:ring-accent-blue/20 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={!repoUrl.trim()}
          className="btn-primary px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-30 disabled:pointer-events-none"
        >
          Analyze
        </button>
      </form>

      {/* Drop zone */}
      <div
        className={`upload-zone p-8 text-center ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-base-800/50 border border-base-600/30 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text-secondary">
              Drop repo folder or <span className="text-accent-blue">browse files</span>
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              Supports .zip, .tar, or folder upload
            </p>
          </div>
        </div>
        <input ref={fileRef} type="file" className="hidden" webkitdirectory="" multiple onChange={handleFileChange} />
      </div>
    </div>
  );
}
