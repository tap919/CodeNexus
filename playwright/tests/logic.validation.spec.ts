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

test.beforeAll(async ({ request }) => {
  const user = await createTestUser('admin', 'admin123', ['admin']);
  const authState = await startTestAuthService([user]);
  authApp = authState.app;
  authServer = authApp.listen(0);
  authURL = `http://localhost:${authServer.address().port}`;

  const { router } = startTestAnalytics();
  analyticsApp = express();
  analyticsApp.use(express.json());
  analyticsApp.use('/api/analytics', router);
  analyticsServer = analyticsApp.listen(0);
  analyticsURL = `http://localhost:${analyticsServer.address().port}`;

  const { body } = await loginAs(request, authURL, 'admin', 'admin123');
  adminToken = body.accessToken;
});

test.afterAll(() => {
  if (authServer) authServer.close();
  if (analyticsServer) analyticsServer.close();
});

test('login rejects non-string username', async ({ request }) => {
  const res = await request.post(`${authURL}/api/auth/login`, {
    data: { username: 123, password: 'admin123' },
  });
  expect(res.status()).toBe(400);
});

test('login rejects non-string password', async ({ request }) => {
  const res = await request.post(`${authURL}/api/auth/login`, {
    data: { username: 'admin', password: 123 },
  });
  expect(res.status()).toBe(400);
});

test('login rejects missing username', async ({ request }) => {
  const res = await request.post(`${authURL}/api/auth/login`, {
    data: { password: 'admin123' },
  });
  expect(res.status()).toBe(400);
});

test('login rejects missing password', async ({ request }) => {
  const res = await request.post(`${authURL}/api/auth/login`, {
    data: { username: 'admin' },
  });
  expect(res.status()).toBe(400);
});

test('TOTP enroll rejects missing token', async ({ request }) => {
  const { body: loginResult, cookie } = await loginAs(request, authURL, 'admin', 'admin123');
  const res = await request.post(`${authURL}/api/auth/2fa/verify-enrollment`, {
    headers: { Cookie: cookie },
    data: {},
  });
  expect(res.status()).toBe(400);
});

test('analytics metric requires prNumber', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { repository: 'test/repo' },
  });
  expect(res.status()).toBe(400);
});

test('analytics metric requires repository', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 42 },
  });
  expect(res.status()).toBe(400);
});

test('analytics event PII fields are redacted', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/event`, {
    headers: getAuthHeaders(adminToken),
    data: { type: 'test_event', data: { email: 'secret@test.com', token: 'sk-abc123', safe: 'ok' } },
  });
  expect(res.status()).toBe(201);

  const eventsRes = await request.get(`${analyticsURL}/api/analytics/events`, {
    headers: getAuthHeaders(adminToken),
  });
  const body = await eventsRes.json();
  const event = body.events.find((e: any) => e.type === 'test_event');
  expect(event).toBeTruthy();
  expect(event.data.email).toBe('[REDACTED]');
  expect(event.data.token).toBe('[REDACTED]');
  expect(event.data.safe).toBe('ok');
});

test('analytics health endpoint returns valid shape', async ({ request }) => {
  const res = await request.get(`${analyticsURL}/api/analytics/health`, {
    headers: getAuthHeaders(adminToken),
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('healthy');
  expect(typeof body.metricsCount).toBe('number');
  expect(typeof body.eventsCount).toBe('number');
});

test('valid metric creates record and returns id', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/metric`, {
    headers: getAuthHeaders(adminToken),
    data: { prNumber: 100, repository: 'test/repo', totalComments: 5 },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  expect(body.status).toBe('recorded');
});
