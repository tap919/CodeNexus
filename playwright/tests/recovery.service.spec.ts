import { test, expect } from '@playwright/test';
import express from 'express';
import {
  startTestAuthService,
  startTestAnalytics,
  loginAs,
  getAuthHeaders,
  createTestUser,
  TEST_JWT_SECRET,
  TEST_ISSUER,
} from './helpers/setup';
import jwt from 'jsonwebtoken';

test('auth and analytics health endpoints both work', async ({ request }) => {
  const user = await createTestUser('svc', 'svc123', ['admin']);
  const authState = await startTestAuthService([user]);
  const authApp = authState.app;
  const authServer = authApp.listen(0);
  const authURL = `http://localhost:${authServer.address().port}`;

  const { router } = startTestAnalytics();
  const analyticsApp = express();
  analyticsApp.use(express.json());
  analyticsApp.use('/api/analytics', router);
  const analyticsServer = analyticsApp.listen(0);
  const analyticsURL = `http://localhost:${analyticsServer.address().port}`;

  // Auth health
  const authHealth = await request.get(`${authURL}/api/health`);
  expect(authHealth.status()).toBe(200);

  // Analytics health (requires auth)
  const token = jwt.sign(
    { sub: 'svc', groups: ['admin'] },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'codenexus-api' },
  );
  const analyticsHealth = await request.get(`${analyticsURL}/api/analytics/health`, {
    headers: getAuthHeaders(token),
  });
  expect(analyticsHealth.status()).toBe(200);
  const body = await analyticsHealth.json();
  expect(body.status).toBe('healthy');

  authServer.close();
  analyticsServer.close();
});

test('analytics returns proper error when auth secret is wrong', async ({ request }) => {
  const { router } = startTestAnalytics();
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', router);
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}`;

  // Sign with wrong secret
  const badToken = jwt.sign(
    { sub: 'user', groups: [] },
    'wrong-secret',
    { algorithm: 'HS256', issuer: TEST_ISSUER },
  );

  const res = await request.get(`${url}/api/analytics/dashboard`, {
    headers: getAuthHeaders(badToken),
  });
  expect(res.status()).toBe(401);

  server.close();
});

test('auth service survives rapid restart of analytics', async ({ request }) => {
  const user = await createTestUser('restart', 'restart123', []);
  const authState = await startTestAuthService([user]);
  const authApp = authState.app;
  const authServer = authApp.listen(0);
  const authURL = `http://localhost:${authServer.address().port}`;

  // Login
  const { body } = await loginAs(request, authURL, 'restart', 'restart123');
  expect(body.success).toBe(true);

  // Session should still be valid after analytics restart (no interaction needed)
  const sessionRes = await request.get(`${authURL}/api/auth/session`, {
    headers: getAuthHeaders(body.accessToken),
  });
  expect(sessionRes.status()).toBe(200);

  authServer.close();
});

test('unauthorized requests get consistent error format', async ({ request }) => {
  const user = await createTestUser('cons', 'cons123', []);
  const authState = await startTestAuthService([user]);
  const authApp = authState.app;
  const authServer = authApp.listen(0);
  const authURL = `http://localhost:${authServer.address().port}`;

  // Multiple unauthorized attempts
  const results = await Promise.all([
    request.post(`${authURL}/api/auth/2fa/enroll`),
    request.post(`${authURL}/api/auth/2fa/totp`, { data: { token: '000000' } }),
    request.get(`${authURL}/oidc/userinfo`),
  ]);

  for (const res of results) {
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
  }

  authServer.close();
});
