import { test, expect } from '@playwright/test';
import express from 'express';
import {
  startTestAuthService,
  startTestAnalytics,
  loginAs,
  getAuthHeaders,
  createTestUser,
} from './helpers/setup';

let authApp: express.Application;
let analyticsApp: express.Application;
let authURL: string;
let analyticsURL: string;
let authServer: any;
let analyticsServer: any;
let adminToken: string;
let viewerToken: string;

test.beforeAll(async ({ request }) => {
  const adminUser = await createTestUser('decadmin', 'decadmin123', ['admin']);
  const viewerUser = await createTestUser('decviewer', 'decviewer123', ['viewer']);
  const authState = await startTestAuthService([adminUser, viewerUser]);
  authApp = authState.app;
  authServer = authApp.listen(0);
  authURL = `http://localhost:${authServer.address().port}`;

  const { router } = startTestAnalytics();
  analyticsApp = express();
  analyticsApp.use(express.json());
  analyticsApp.use('/api/analytics', router);
  analyticsServer = analyticsApp.listen(0);
  analyticsURL = `http://localhost:${analyticsServer.address().port}`;

  const { body: adminBody } = await loginAs(request, authURL, 'decadmin', 'decadmin123');
  adminToken = adminBody.accessToken;

  const { body: viewerBody } = await loginAs(request, authURL, 'decviewer', 'decviewer123');
  viewerToken = viewerBody.accessToken;
});

test.afterAll(() => {
  if (authServer) authServer.close();
  if (analyticsServer) analyticsServer.close();
});

test.beforeEach(async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/clear`, {
    headers: getAuthHeaders(adminToken),
  });
});

test('GET /api/analytics/dashboard returns proper DashboardData shape', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 1, repository: 'test/repo', totalComments: 10, botComments: 3, humanComments: 7, fixesApplied: 2, timeToFix: 120, confidence: 85 },
  });

  const res = await request.get(`${analyticsURL}/api/analytics/dashboard`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('totalPRsReviewed');
  expect(body).toHaveProperty('totalFixesApplied');
  expect(body).toHaveProperty('averageFixTime');
  expect(body).toHaveProperty('botVsHumanRatio');
  expect(body).toHaveProperty('topRepositories');
  expect(body).toHaveProperty('recentActivity');
  expect(body).toHaveProperty('securityAlerts');
  expect(typeof body.totalPRsReviewed).toBe('number');
  expect(typeof body.totalFixesApplied).toBe('number');
  expect(Array.isArray(body.topRepositories)).toBe(true);
  expect(Array.isArray(body.recentActivity)).toBe(true);
});

test('GET /api/analytics/timeseries returns proper time series data', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 1, repository: 'test/repo', totalComments: 5, botComments: 2, humanComments: 3, fixesApplied: 1, timeToFix: 60, confidence: 90 },
  });

  const res = await request.get(`${analyticsURL}/api/analytics/timeseries`, {
    headers: getAuthHeaders(adminToken),
    params: { metric: 'prs_reviewed', interval: 'day' },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('metric');
  expect(body).toHaveProperty('interval');
  expect(body).toHaveProperty('points');
  expect(body.metric).toBe('prs_reviewed');
  expect(Array.isArray(body.points)).toBe(true);
  expect(body.points.length).toBeGreaterThan(0);
});

test('GET /api/analytics/timeseries rejects invalid metric', async ({ request }) => {
  const res = await request.get(`${analyticsURL}/api/analytics/timeseries`, {
    headers: getAuthHeaders(adminToken),
    params: { metric: 'invalid_metric' },
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toContain('Invalid metric');
});

test('GET /api/analytics/ratio returns bot/human ratio data', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 1, repository: 'test/repo', totalComments: 10, botComments: 4, humanComments: 6, fixesApplied: 1, timeToFix: 30, confidence: 80 },
  });

  const res = await request.get(`${analyticsURL}/api/analytics/ratio`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('overall');
  expect(body).toHaveProperty('byRepository');
  expect(body).toHaveProperty('trend');
  expect(typeof body.overall).toBe('number');
  expect(Array.isArray(body.trend)).toBe(true);
});

test('POST /api/analytics/metric with valid data produces 201', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: {
      prNumber: 42,
      repository: 'org/repo',
      totalComments: 15,
      botComments: 5,
      humanComments: 10,
      fixesApplied: 3,
      timeToFix: 300,
      confidence: 95,
    },
  });

  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('id');
  expect(body.status).toBe('recorded');
});

test('POST /api/analytics/metric with missing fields returns 400', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 1 },
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toContain('Missing required fields');
});

test('POST /api/analytics/event with PII-containing data redacts fields', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/event`, {
    headers: getAuthHeaders(adminToken),
    data: {
      type: 'user_action',
      data: {
        email: 'user@example.com',
        token: 'secret-token-123',
        password: 'supersecret',
        name: 'John Doe',
        action: 'view',
        page: 'dashboard',
      },
    },
  });

  expect(res.status()).toBe(201);

  const eventsRes = await request.get(`${analyticsURL}/api/analytics/events`, {
    headers: getAuthHeaders(adminToken),
  });
  const body = await eventsRes.json();
  expect(body.events.length).toBeGreaterThan(0);
  const event = body.events[body.events.length - 1];
  expect(event.data.email).toBe('[REDACTED]');
  expect(event.data.token).toBe('[REDACTED]');
  expect(event.data.password).toBe('[REDACTED]');
  expect(event.data.name).toBe('[REDACTED]');
  expect(event.data.action).toBe('view');
  expect(event.data.page).toBe('dashboard');
});

test('GET /api/analytics/events returns sanitized events', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 99, repository: 'events/repo', totalComments: 1, botComments: 0, humanComments: 1, fixesApplied: 0, timeToFix: 0, confidence: 50 },
  });

  const res = await request.get(`${analyticsURL}/api/analytics/events`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('count');
  expect(body).toHaveProperty('events');
  expect(typeof body.count).toBe('number');
  expect(Array.isArray(body.events)).toBe(true);
});

test('GET /api/analytics/events filters by type', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/event`, {
    headers: getAuthHeaders(adminToken),
    data: { type: 'security_alert', data: { severity: 'high' } },
  });

  const res = await request.get(`${analyticsURL}/api/analytics/events`, {
    headers: getAuthHeaders(adminToken),
    params: { type: 'security_alert' },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.events.length).toBeGreaterThanOrEqual(1);
  body.events.forEach((e: any) => {
    expect(e.type).toBe('security_alert');
  });
});

test('non-admin user receives 403 on POST /api/analytics/clear', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/clear`, {
    headers: getAuthHeaders(viewerToken),
  });

  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('forbidden');
});

test('admin user receives 200 on POST /api/analytics/clear', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 1, repository: 'temp/repo', totalComments: 1, botComments: 0, humanComments: 1, fixesApplied: 0, timeToFix: 0, confidence: 50 },
  });

  const res = await request.post(`${analyticsURL}/api/analytics/clear`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.cleared).toBe(true);

  const dashboardRes = await request.get(`${analyticsURL}/api/analytics/dashboard`, {
    headers: getAuthHeaders(adminToken),
  });
  const dashboard = await dashboardRes.json();
  expect(dashboard.totalPRsReviewed).toBe(0);
});

test('GET /api/analytics/breakdown returns repository breakdowns', async ({ request }) => {
  await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 1, repository: 'org/repo-a', totalComments: 10, botComments: 5, humanComments: 5, fixesApplied: 2, timeToFix: 100, confidence: 80 },
  });

  const res = await request.get(`${analyticsURL}/api/analytics/breakdown`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('repositories');
  expect(Array.isArray(body.repositories)).toBe(true);
  expect(body.repositories.length).toBeGreaterThan(0);
  expect(body.repositories[0]).toHaveProperty('repository');
  expect(body.repositories[0]).toHaveProperty('totalPRs');
  expect(body.repositories[0]).toHaveProperty('averageFixTime');
});

test('analytics health endpoint returns healthy with token', async ({ request }) => {
  const res = await request.get(`${analyticsURL}/api/analytics/health`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('healthy');
  expect(body).toHaveProperty('timestamp');
  expect(body).toHaveProperty('metricsCount');
  expect(body).toHaveProperty('eventsCount');
});
