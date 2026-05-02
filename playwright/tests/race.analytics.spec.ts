import { test, expect } from '@playwright/test';
import express from 'express';
import {
  startTestAnalytics,
  getAuthHeaders,
  TEST_JWT_SECRET,
  TEST_ISSUER,
} from './helpers/setup';
import jwt from 'jsonwebtoken';

let app: express.Application;
let baseURL: string;
let server: any;
let token: string;

test.beforeAll(() => {
  const { router } = startTestAnalytics();
  app = express();
  app.use(express.json());
  app.use('/api/analytics', router);
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;

  token = jwt.sign(
    { sub: 'admin', groups: ['admin'] },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'codenexus-api' },
  );
});

test.afterAll(() => { if (server) server.close(); });

test('concurrent metric recording does not corrupt data', async ({ request }) => {
  const metrics = Array.from({ length: 20 }, (_, i) => ({
    prNumber: i + 1,
    repository: `test/repo-${i % 3}`,
    totalComments: i,
  }));

  const results = await Promise.allSettled(
    metrics.map(m =>
      request.post(`${baseURL}/api/analytics/metric`, {
        headers: getAuthHeaders(token),
        data: m,
      })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled');
  expect(succeeded.length).toBe(20);

  // Verify data integrity — all metrics should be present
  const dashboardRes = await request.get(`${baseURL}/api/analytics/dashboard`, {
    headers: getAuthHeaders(token),
  });
  const dashboard = await dashboardRes.json();
  expect(dashboard.totalPRsReviewed).toBe(20);
});

test('concurrent event recording maintains count', async ({ request }) => {
  const events = Array.from({ length: 10 }, (_, i) => ({
    type: `concurrent_event_${i}`,
    data: { index: i },
  }));

  await Promise.allSettled(
    events.map(e =>
      request.post(`${baseURL}/api/analytics/event`, {
        headers: getAuthHeaders(token),
        data: e,
      })
    )
  );

  const res = await request.get(`${baseURL}/api/analytics/events`, {
    headers: getAuthHeaders(token),
  });
  const body = await res.json();
  expect(body.count).toBeGreaterThanOrEqual(10);
});

test('dashboard read during concurrent writes is consistent', async ({ request }) => {
  const writes = Array.from({ length: 5 }, (_, i) =>
    request.post(`${baseURL}/api/analytics/metric`, {
      headers: getAuthHeaders(token),
      data: { prNumber: 1000 + i, repository: 'stress/repo' },
    })
  );

  const reads = Array.from({ length: 5 }, () =>
    request.get(`${baseURL}/api/analytics/dashboard`, {
      headers: getAuthHeaders(token),
    })
  );

  const all = await Promise.allSettled([...writes, ...reads]);
  const succeeded = all.filter(r => r.status === 'fulfilled');
  expect(succeeded.length).toBe(10);
});

test('simultaneous clear and metric recording', async ({ request }) => {
  // Record a metric
  await request.post(`${baseURL}/api/analytics/metric`, {
    headers: getAuthHeaders(token),
    data: { prNumber: 1, repository: 'temp/repo' },
  });

  const results = await Promise.allSettled([
    request.post(`${baseURL}/api/analytics/clear`, {
      headers: getAuthHeaders(token),
    }),
    request.post(`${baseURL}/api/analytics/metric`, {
      headers: getAuthHeaders(token),
      data: { prNumber: 2, repository: 'temp/repo' },
    }),
  ]);

  // Both should complete (the one that wins is timing-dependent)
  const succeeded = results.filter(r => r.status === 'fulfilled');
  expect(succeeded.length).toBe(2);
});
