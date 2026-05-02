import { create } from 'zustand';

export interface DashboardMetric {
  openReviews: number;
  atRiskPRs: number;
  escalationsWaiting: number;
  regressedBuilds: number;
  healthyMerges: number;
  lastUpdated: string;
}

interface DashboardState {
  metrics: DashboardMetric;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  setMetrics: (m: Partial<DashboardMetric>) => void;
  setConnectionStatus: (s: 'connected' | 'disconnected' | 'reconnecting') => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  metrics: {
    openReviews: 0,
    atRiskPRs: 0,
    escalationsWaiting: 0,
    regressedBuilds: 0,
    healthyMerges: 0,
    lastUpdated: new Date().toISOString(),
  },
  connectionStatus: 'disconnected',
  setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m, lastUpdated: new Date().toISOString() } })),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
