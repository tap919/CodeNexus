import { test, expect } from '@playwright/test';
import express from 'express';
import { startTestAuthService, loginAs, createTestUser } from './helpers/setup';

let app: express.Application;
let baseURL: string;
let server: any;

test.beforeAll(async () => {
  const user = await createTestUser('racer', 'racer123', ['user']);
  const state = await startTestAuthService([user]);
  app = state.app;
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;
});

test.afterAll(() => { if (server) server.close(); });

test('duplicate simultaneous login creates separate sessions', async ({ request }) => {
  const results = await Promise.allSettled([
    loginAs(request, baseURL, 'racer', 'racer123'),
    loginAs(request, baseURL, 'racer', 'racer123'),
    loginAs(request, baseURL, 'racer', 'racer123'),
  ]);

  const succeeded = results.filter(r => r.status === 'fulfilled').map(
    (r: any) => r.value
  );
  expect(succeeded.length).toBe(3);
  // Each should have a unique sessionId
  const sessionIds = succeeded.map(s => s.body.sessionId);
  const uniqueIds = new Set(sessionIds);
  expect(uniqueIds.size).toBe(3);
});

test('simultaneous failed and successful login for same user', async ({ request }) => {
  const results = await Promise.allSettled([
    loginAs(request, baseURL, 'racer', 'wrongpass'),
    loginAs(request, baseURL, 'racer', 'racer123'),
    loginAs(request, baseURL, 'racer', 'wrongpass'),
  ]);

  const statuses = results.filter(r => r.status === 'fulfilled').map(
    (r: any) => r.value.statusCode
  );
  expect(statuses).toContain(200);
  expect(statuses).toContain(401);
});

test('parallel session checks using same cookie return consistent identity', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, 'racer', 'racer123');

  const results = await Promise.all([
    request.get(`${baseURL}/api/auth/session`, { headers: { Cookie: cookie } }),
    request.get(`${baseURL}/api/auth/session`, { headers: { Cookie: cookie } }),
    request.get(`${baseURL}/api/auth/session`, { headers: { Cookie: cookie } }),
  ]);

  for (const res of results) {
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.session.username).toBe('racer');
  }
});

test('rapid login-logout cycling does not corrupt state', async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    const { cookie } = await loginAs(request, baseURL, 'racer', 'racer123');
    await request.post(`${baseURL}/api/auth/logout`, { headers: { Cookie: cookie } });
    const res = await request.get(`${baseURL}/api/auth/session`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  }
});

test('concurrent health checks return ok', async ({ request }) => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => request.get(`${baseURL}/api/health`))
  );
  for (const res of results) {
    expect(res.status()).toBe(200);
  }
});
