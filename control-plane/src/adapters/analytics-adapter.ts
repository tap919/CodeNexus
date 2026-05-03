import type { ReviewMetric } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { AnalyticsCollector } from '@codenexus/analytics';

const collector = new AnalyticsCollector();

export function createDefaultAnalytics(): ModuleAdapters['analytics'] {
  return {
    async recordMetric(metric: ReviewMetric): Promise<void> {
      await collector.recordMetric(metric);
    },
    async recordEvent(event: string, data: Record<string, unknown>): Promise<void> {
      await collector.recordEvent(event, data);
    },
  };
}
