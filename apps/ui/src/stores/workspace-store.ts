import { create } from 'zustand';

export interface WorkspaceContext {
  repository: string;
  branch: string;
  prNumber: number | null;
  environment: string;
  userName: string;
  userRole: string;
}

interface WorkspaceState extends WorkspaceContext {
  setRepository: (repo: string) => void;
  setBranch: (branch: string) => void;
  setPR: (pr: number | null) => void;
  setContext: (ctx: Partial<WorkspaceContext>) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  repository: '',
  branch: '',
  prNumber: null,
  environment: 'development',
  userName: '',
  userRole: 'viewer',
  setRepository: (repo) => set({ repository: repo }),
  setBranch: (branch) => set({ branch }),
  setPR: (pr) => set({ prNumber: pr }),
  setContext: (ctx) => set(ctx),
}));
