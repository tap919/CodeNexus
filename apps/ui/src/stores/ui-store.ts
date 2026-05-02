import { create } from 'zustand';

export type ReviewMode = 'vibe' | 'engineer' | 'security';

interface UIState {
  mode: ReviewMode;
  setMode: (mode: ReviewMode) => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  selectedFindingId: string | null;
  setSelectedFinding: (id: string | null) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  mode: 'engineer',
  setMode: (mode) => set({ mode }),
  leftPanelOpen: true,
  rightPanelOpen: true,
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  selectedFindingId: null,
  setSelectedFinding: (id) => set({ selectedFindingId: id }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
