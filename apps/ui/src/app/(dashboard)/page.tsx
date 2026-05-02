'use client';

import { KPIStrip } from '@/components/dashboard/kpi-strip';
import { BuildHealthPulseCard } from '@/components/dashboard/build-health-pulse';
import { AtRiskTimeline } from '@/components/dashboard/at-risk-timeline';
import { ReviewTrendChart } from '@/components/dashboard/review-trend-chart';
import { TopSubsystemRisks } from '@/components/dashboard/top-subsystem-risks';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useEffect } from 'react';
import { useWebSocket } from '@/providers/ws-provider';

export default function HomePage() {
  const { setMetrics, setConnectionStatus } = useDashboardStore();
  const { connected, subscribe } = useWebSocket();

  useEffect(() => {
    setConnectionStatus(connected ? 'connected' : 'disconnected');
  }, [connected, setConnectionStatus]);

  useEffect(() => {
    const unsub = subscribe('dashboard:metrics', (payload: any) => {
      if (payload) setMetrics(payload);
    });
    return unsub;
  }, [subscribe, setMetrics]);

  useEffect(() => {
    setMetrics({
      openReviews: 24,
      atRiskPRs: 5,
      escalationsWaiting: 3,
      regressedBuilds: 2,
      healthyMerges: 87,
    });
  }, [setMetrics]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <KPIStrip />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BuildHealthPulseCard />
        <TopSubsystemRisks />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ReviewTrendChart />
        </div>
        <AtRiskTimeline />
      </div>
    </div>
  );
}
