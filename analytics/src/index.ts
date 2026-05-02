/**
 * CodeNexus Analytics
 *
 * Fused from superset's analytics engine. Provides review metric
 * collection and aggregation, dashboard data generation, time-series
 * tracking, bot vs human ratio analysis, repository-level breakdowns,
 * and a webhook-based reporting endpoint (Express router).
 *
 * ```ts
 * import { AnalyticsCollector, createAnalyticsRouter } from '@codenexus/analytics';
 * import express from 'express';
 *
 * const collector = new AnalyticsCollector();
 * await collector.recordMetric({ prNumber: 42, repository: 'org/repo', ... });
 *
 * const app = express();
 * app.use('/api/analytics', createAnalyticsRouter(collector));
 * ```
 */

import { v4 as uuidv4 } from 'uuid';
import { jwtVerify } from 'jose';
import Database from 'better-sqlite3';
import type { Router, Request, Response, NextFunction } from 'express';
import type {
  ReviewMetric,
  DashboardData,
} from '../../shared/src/types.js';

// ─── Re-exports ───────────────────────────────────────────────

export type { ReviewMetric, DashboardData } from '../../shared/src/types.js';

// ─── Extended Interfaces ──────────────────────────────────────

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  metric: string;
  repository?: string;
}

export interface RepositoryBreakdown {
  repository: string;
  totalPRs: number;
  totalComments: number;
  botComments: number;
  humanComments: number;
  fixesApplied: number;
  averageFixTime: number;    // seconds
  averageConfidence: number; // 0-100
  lastActivity: string;
}

export interface BotHumanRatio {
  overall: number;  // bot / human
  byRepository: Record<string, number>;
  trend: TimeSeriesPoint[];
}

export interface AggregatedMetrics {
  totalPRs: number;
  totalComments: number;
  totalFixes: number;
  averageFixTime: number;
  averageConfidence: number;
  botCommentRatio: number;
  humanCommentRatio: number;
}

export interface TimeSeriesOptions {
  metric: 'prs_reviewed' | 'fixes_applied' | 'fix_time' | 'bot_ratio';
  from?: string;
  to?: string;
  interval?: 'hour' | 'day' | 'week' | 'month';
  repository?: string;
}

export interface ReportEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ─── AnalyticsCollectorConfig ────────────────────────────────

export interface AnalyticsCollectorConfig {
  dbPath?: string; // If provided, enables SQLite persistence
}

// ─── AnalyticsCollector ───────────────────────────────────────

export class AnalyticsCollector {
  private db: Database.Database | null = null;
  private inMemoryMetrics: ReviewMetric[] = [];
  private inMemoryEvents: ReportEvent[] = [];
  private inMemoryTimeSeries: Map<string, TimeSeriesPoint[]> = new Map();
  private listeners: Set<(metric: ReviewMetric) => void> = new Set();

  constructor(config?: AnalyticsCollectorConfig) {
    if (config?.dbPath) {
      this.db = new Database(config.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.initSchema();
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        pr_number INTEGER NOT NULL,
        repository TEXT NOT NULL,
        total_comments INTEGER DEFAULT 0,
        bot_comments INTEGER DEFAULT 0,
        human_comments INTEGER DEFAULT 0,
        fixes_applied INTEGER DEFAULT 0,
        time_to_fix REAL DEFAULT 0,
        confidence REAL DEFAULT 0,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS time_series (
        id TEXT PRIMARY KEY,
        metric TEXT NOT NULL,
        point_date TEXT NOT NULL,
        value REAL DEFAULT 0,
        repository TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_repo ON metrics(repository);
      CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
    `);
  }

  // ── Metric Recording ───────────────────────────────────

  /**
   * Record a review metric.
   */
  async recordMetric(metric: ReviewMetric): Promise<{ id: string; status: string }> {
    const id = uuidv4();
    const enriched: ReviewMetric = {
      ...metric,
      timestamp: metric.timestamp ?? new Date().toISOString(),
    };

    this.inMemoryMetrics.push(enriched);

    // Persist to SQLite if enabled
    if (this.db) {
      const stmt = this.db.prepare(
        `INSERT INTO metrics (id, pr_number, repository, total_comments, bot_comments, human_comments, fixes_applied, time_to_fix, confidence, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      stmt.run(
        id,
        metric.prNumber,
        metric.repository,
        metric.totalComments,
        metric.botComments,
        metric.humanComments,
        metric.fixesApplied,
        metric.timeToFix,
        metric.confidence,
        metric.timestamp ?? new Date().toISOString(),
      );
    }

    // Add to time-series
    this.addTimeSeriesPoint('prs_reviewed', 1, enriched.repository);
    this.addTimeSeriesPoint('fix_time', enriched.timeToFix, enriched.repository);
    this.addTimeSeriesPoint('bot_ratio', this.computeBotRatioForMetric(enriched), enriched.repository);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(enriched);
      } catch {
        // Swallow listener errors
      }
    }

    return { id, status: 'recorded' };
  }

  /**
   * Record a generic analytics event.
   */
  async recordEvent(event: string, data: Record<string, unknown>): Promise<{ id: string; status: string }> {
    const sanitized = this.sanitizePII(data);
    const id = uuidv4();
    const reportEvent: ReportEvent = {
      id,
      type: event,
      data: sanitized,
      timestamp: new Date().toISOString(),
    };

    this.inMemoryEvents.push(reportEvent);

    // Persist to SQLite if enabled (with sanitized PII)
    if (this.db) {
      const stmt = this.db.prepare(
        `INSERT INTO events (id, type, data, timestamp) VALUES (?, ?, ?, ?)`,
      );
      stmt.run(id, event, JSON.stringify(sanitized), new Date().toISOString());
    }

    this.addTimeSeriesPoint('events', 1);

    return { id, status: 'recorded' };
  }

  /**
   * Subscribe to new metrics as they arrive.
   */
  onMetric(callback: (metric: ReviewMetric) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // ── Aggregation ────────────────────────────────────────

  /**
   * Get aggregated metrics across all records.
   */
  aggregate(filter?: { repository?: string; since?: string }): AggregatedMetrics {
    let filtered = this.inMemoryMetrics;

    if (filter?.repository) {
      filtered = filtered.filter(m => m.repository === filter.repository);
    }
    if (filter?.since) {
      const sinceTime = new Date(filter.since).getTime();
      filtered = filtered.filter(m => new Date(m.timestamp).getTime() >= sinceTime);
    }

    if (filtered.length === 0) {
      return {
        totalPRs: 0,
        totalComments: 0,
        totalFixes: 0,
        averageFixTime: 0,
        averageConfidence: 0,
        botCommentRatio: 0,
        humanCommentRatio: 0,
      };
    }

    const totalComments = filtered.reduce((s, m) => s + m.totalComments, 0);
    const totalBot = filtered.reduce((s, m) => s + m.botComments, 0);
    const totalHuman = filtered.reduce((s, m) => s + m.humanComments, 0);
    const totalFixes = filtered.reduce((s, m) => s + m.fixesApplied, 0);
    const totalFixTime = filtered.reduce((s, m) => s + m.timeToFix, 0);
    const totalConfidence = filtered.reduce((s, m) => s + m.confidence, 0);
    const fixCount = filtered.filter(m => m.fixesApplied > 0).length;

    return {
      totalPRs: filtered.length,
      totalComments,
      totalFixes,
      averageFixTime: fixCount > 0 ? totalFixTime / fixCount : 0,
      averageConfidence: filtered.length > 0 ? totalConfidence / filtered.length : 0,
      botCommentRatio: totalComments > 0 ? totalBot / totalComments : 0,
      humanCommentRatio: totalComments > 0 ? totalHuman / totalComments : 0,
    };
  }

  // ── Dashboard Data ─────────────────────────────────────

  /**
   * Generate full dashboard data for the UI.
   */
  async getDashboardData(): Promise<DashboardData> {
    const aggregated = this.aggregate();
    const recentActivity = this.getRecentMetrics(20);
    const repos = this.getRepositoryBreakdown();
    const ratio = this.getBotHumanRatio();

    return {
      totalPRsReviewed: aggregated.totalPRs,
      totalFixesApplied: aggregated.totalFixes,
      averageFixTime: aggregated.averageFixTime,
      botVsHumanRatio: ratio.overall,
      topRepositories: repos
        .sort((a, b) => b.totalPRs - a.totalPRs)
        .slice(0, 10)
        .map(r => r.repository),
      recentActivity,
      securityAlerts: this.inMemoryEvents.filter(e => e.type === 'security_alert').length,
    };
  }

  // ── Time-Series Tracking ───────────────────────────────

  /**
   * Query time-series data with filtering options.
   */
  getTimeSeries(options: TimeSeriesOptions): TimeSeriesPoint[] {
    const key = options.repository
      ? `${options.metric}:${options.repository}`
      : options.metric;

    let data = this.inMemoryTimeSeries.get(key) ?? [];

    // Apply time range filter
    if (options.from) {
      const fromTime = new Date(options.from).getTime();
      data = data.filter(p => new Date(p.timestamp).getTime() >= fromTime);
    }
    if (options.to) {
      const toTime = new Date(options.to).getTime();
      data = data.filter(p => new Date(p.timestamp).getTime() <= toTime);
    }

    // Apply interval bucketing
    if (options.interval && options.interval !== 'hour') {
      data = this.bucketTimeSeries(data, options.interval);
    }

    return data.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  // ── Bot vs Human Ratio ─────────────────────────────────

  /**
   * Compute bot vs human comment ratio across all data.
   */
  getBotHumanRatio(): BotHumanRatio {
    const aggregated = this.aggregate();
    const total = aggregated.botCommentRatio + aggregated.humanCommentRatio;

    const byRepository: Record<string, number> = {};
    const repos = this.getRepositoryList();
    for (const repo of repos) {
      const repoAgg = this.aggregate({ repository: repo });
      byRepository[repo] = repoAgg.totalComments > 0
        ? repoAgg.botComments / repoAgg.totalComments
        : 0;
    }

    const trend = this.getTimeSeries({
      metric: 'bot_ratio',
      interval: 'day',
    });

    return {
      overall: total > 0 ? aggregated.botCommentRatio / total : 0,
      byRepository,
      trend,
    };
  }

  // ── Repository Breakdown ───────────────────────────────

  /**
   * Get per-repository breakdown of review metrics.
   */
  getRepositoryBreakdown(): RepositoryBreakdown[] {
    const repos = this.getRepositoryList();

    return repos.map(repo => {
      const repoMetrics = this.inMemoryMetrics.filter(m => m.repository === repo);
      const aggregated = this.aggregate({ repository: repo });

      const lastActivity = repoMetrics.length > 0
        ? repoMetrics.reduce((latest, m) => {
            const t = new Date(m.timestamp).getTime();
            return t > new Date(latest).getTime() ? m.timestamp : latest;
          }, repoMetrics[0].timestamp)
        : new Date().toISOString();

      return {
        repository: repo,
        totalPRs: repoMetrics.length,
        totalComments: aggregated.totalComments,
        botComments: repoMetrics.reduce((s, m) => s + m.botComments, 0),
        humanComments: repoMetrics.reduce((s, m) => s + m.humanComments, 0),
        fixesApplied: aggregated.totalFixes,
        averageFixTime: aggregated.averageFixTime,
        averageConfidence: aggregated.averageConfidence,
        lastActivity,
      };
    });
  }

  /**
   * Get recent metrics up to a limit.
   */
  getRecentMetrics(limit: number = 10): ReviewMetric[] {
    return [...this.inMemoryMetrics]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get all recorded events.
   */
  getEvents(type?: string): ReportEvent[] {
    if (type) {
      return this.inMemoryEvents.filter(e => e.type === type);
    }
    return [...this.inMemoryEvents];
  }

  /**
   * Get all recorded metrics.
   */
  getAllMetrics(): ReviewMetric[] {
    if (this.db) {
      return this.db.prepare('SELECT * FROM metrics ORDER BY timestamp DESC').all() as ReviewMetric[];
    }
    return [...this.inMemoryMetrics];
  }

  /**
   * Clear all stored data.
   */
  async clearAll(): Promise<void> {
    this.inMemoryMetrics = [];
    this.inMemoryEvents = [];
    this.inMemoryTimeSeries.clear();
    if (this.db) {
      this.db.exec('DELETE FROM metrics; DELETE FROM events; DELETE FROM time_series;');
    }
  }

  /**
   * Close the SQLite database connection if open.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ── Private Methods ────────────────────────────────────

  private addTimeSeriesPoint(metric: string, value: number, repository?: string): void {
    const key = repository ? `${metric}:${repository}` : metric;

    if (!this.inMemoryTimeSeries.has(key)) {
      this.inMemoryTimeSeries.set(key, []);
    }

    this.inMemoryTimeSeries.get(key)!.push({
      timestamp: new Date().toISOString(),
      value,
      metric,
      repository,
    });
  }

  private computeBotRatioForMetric(metric: ReviewMetric): number {
    if (metric.totalComments === 0) return 0;
    return metric.botComments / metric.totalComments;
  }

  private getRepositoryList(): string[] {
    const repos = new Set<string>();
    for (const m of this.inMemoryMetrics) {
      if (m.repository) repos.add(m.repository);
    }
    return Array.from(repos);
  }

  private sanitizePII(data: Record<string, unknown>, depth: number = 10): Record<string, unknown> {
    if (depth <= 0) return { '[TRUNCATED]': 'max depth exceeded' };

    const PII_KEYS = ['email', 'token', 'password', 'secret', 'key', 'credential',
      'phone', 'ssn', 'address', 'name', 'ip'];
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (PII_KEYS.some(pk => k.toLowerCase().includes(pk))) {
        result[k] = '[REDACTED]';
      } else if (Array.isArray(v)) {
        result[k] = v.map(el => this.sanitizePII(el as Record<string, unknown>, depth - 1));
      } else if (typeof v === 'object' && v !== null) {
        result[k] = this.sanitizePII(v as Record<string, unknown>, depth - 1);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  private bucketTimeSeries(
    data: TimeSeriesPoint[],
    interval: 'day' | 'week' | 'month',
  ): TimeSeriesPoint[] {
    if (data.length === 0) return [];

    const buckets = new Map<string, { sum: number; count: number; metric: string }>();

    for (const point of data) {
      const date = new Date(point.timestamp);
      let key: string;

      switch (interval) {
        case 'day':
          key = date.toISOString().slice(0, 10);
          break;
        case 'week': {
          const startOfWeek = new Date(date);
          startOfWeek.setDate(date.getDate() - date.getDay());
          key = startOfWeek.toISOString().slice(0, 10);
          break;
        }
        case 'month':
          key = date.toISOString().slice(0, 7);
          break;
      }

      if (!buckets.has(key)) {
        buckets.set(key, { sum: 0, count: 0, metric: point.metric });
      }
      const bucket = buckets.get(key)!;
      bucket.sum += point.value;
      bucket.count++;
    }

    return Array.from(buckets.entries()).map(([key, bucket]) => ({
      timestamp: key,
      value: bucket.sum / bucket.count,
      metric: bucket.metric,
    }));
  }
}

// ─── Express Router Factory ──────────────────────────────────

/**
 * Create an Express router with webhook-based reporting endpoints.
 *
 * Endpoints:
 *   POST /api/analytics/metric   — Record a review metric
 *   POST /api/analytics/event    — Record a generic event
 *   GET  /api/analytics/dashboard — Get dashboard data
 *   GET  /api/analytics/metrics  — List all metrics
 *   GET  /api/analytics/breakdown — Repository breakdown
 *   GET  /api/analytics/ratio    — Bot vs human ratio
 *   GET  /api/analytics/timeseries — Time-series data
 *   GET  /api/analytics/events   — List events
 *   POST /api/analytics/clear    — Clear all data
 *   GET  /api/analytics/health   — Health check
 */
async function analyticsAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET || '');
    const { payload } = await jwtVerify(token, secret, {
      issuer: process.env.AUTH_JWT_ISSUER || 'https://auth.codenexus.dev',
      algorithms: ['HS256'],
    });
    (res.locals as any).authPayload = payload;
    next();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Analytics] JWT verification failed:', (err as Error).message);
    }
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function createAnalyticsRouter(collector: AnalyticsCollector): Router {
  // Dynamic import to avoid hard dependency when not using Express
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { Router: ExpressRouter } = require('express');
    const router = ExpressRouter();

    // ── POST /metric ─────────────────────────────────────
    router.post('/metric', analyticsAuth, async (req: Request, res: Response) => {
      try {
        const metric = req.body as ReviewMetric;

        if (!metric.prNumber || !metric.repository) {
          return res.status(400).json({
            error: 'Missing required fields: prNumber, repository',
          });
        }

        const result = await collector.recordMetric(metric);
        return res.status(201).json(result);
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── POST /event ──────────────────────────────────────
    router.post('/event', analyticsAuth, async (req: Request, res: Response) => {
      try {
        const { type, data } = req.body as { type: string; data: Record<string, unknown> };

        if (!type) {
          return res.status(400).json({ error: 'Missing required field: type' });
        }

        const result = await collector.recordEvent(type, data ?? {});
        return res.status(201).json(result);
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /dashboard ───────────────────────────────────
    router.get('/dashboard', analyticsAuth, async (_req: Request, res: Response) => {
      try {
        const data = await collector.getDashboardData();
        return res.json(data);
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /metrics ─────────────────────────────────────
    router.get('/metrics', analyticsAuth, (_req: Request, res: Response) => {
      try {
        const repository = _req.query.repository as string | undefined;
        const since = _req.query.since as string | undefined;

        if (repository || since) {
          const metrics = collector.getAllMetrics().filter(m => {
            if (repository && m.repository !== repository) return false;
            if (since && new Date(m.timestamp).getTime() < new Date(since).getTime()) return false;
            return true;
          });
          const aggregated = collector.aggregate({ repository, since });
          return res.json({ metrics, aggregated });
        }

        return res.json({
          metrics: collector.getAllMetrics(),
          aggregated: collector.aggregate(),
        });
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /breakdown ───────────────────────────────────
    router.get('/breakdown', analyticsAuth, (_req: Request, res: Response) => {
      try {
        const breakdown = collector.getRepositoryBreakdown();
        return res.json({ repositories: breakdown });
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /ratio ───────────────────────────────────────
    router.get('/ratio', analyticsAuth, (_req: Request, res: Response) => {
      try {
        const ratio = collector.getBotHumanRatio();
        return res.json(ratio);
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /timeseries ──────────────────────────────────
    router.get('/timeseries', analyticsAuth, (req: Request, res: Response) => {
      try {
        const metric = (req.query.metric as string) ?? 'prs_reviewed';
        const validMetrics = ['prs_reviewed', 'fixes_applied', 'fix_time', 'bot_ratio'];

        if (!validMetrics.includes(metric)) {
          return res.status(400).json({
            error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}`,
          });
        }

        const interval = (req.query.interval as 'hour' | 'day' | 'week' | 'month') ?? 'day';
        const data = collector.getTimeSeries({
          metric: metric as TimeSeriesOptions['metric'],
          from: req.query.from as string,
          to: req.query.to as string,
          interval,
          repository: req.query.repository as string,
        });

        return res.json({ metric, interval, points: data });
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /events ──────────────────────────────────────
    router.get('/events', analyticsAuth, (_req: Request, res: Response) => {
      try {
        const type = _req.query.type as string | undefined;
        const events = collector.getEvents(type);
        return res.json({ count: events.length, events });
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── POST /clear ──────────────────────────────────────
    router.post('/clear', analyticsAuth, async (_req: Request, res: Response) => {
      try {
        const payload = (res.locals as any).authPayload;
        const groups = (payload?.groups as string[]) || [];
        if (!groups.includes('admin')) {
          return res.status(403).json({ error: 'forbidden' });
        }
        await collector.clearAll();
        return res.json({ cleared: true });
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    });

    // ── GET /health ──────────────────────────────────────
    router.get('/health', analyticsAuth, (_req: Request, res: Response) => {
      return res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        metricsCount: collector.getAllMetrics().length,
        eventsCount: collector.getEvents().length,
        repositories: collector.getRepositoryBreakdown().length,
      });
    });

    return router;
  } catch {
    // Express not available
    throw new Error(
      'Express is required for createAnalyticsRouter. ' +
      'Install it: npm install express',
    );
  }
}

// ─── Default Export ───────────────────────────────────────────

export default AnalyticsCollector;
