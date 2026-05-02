import { test, expect } from '@playwright/test';
import express from 'express';
import {
  startTestAuthService,
  loginAs,
  getAuthHeaders,
  createTestUser,
  TEST_JWT_SECRET,
} from './helpers/setup';

let app: express.Application;
let baseURL: string;
let server: any;

test.beforeAll(async () => {
  const state = await startTestAuthService();
  app = state.app;
  server = app.listen(0);
  const addr = server.address();
  baseURL = `http://localhost:${addr.port}`;
});

test.afterAll(async () => {
  if (server) server.close();
});

test('login succeeds with valid credentials', async ({ request }) => {
  const { statusCode, body, cookie } = await loginAs(request, baseURL, 'admin', 'admin123');
  expect(statusCode).toBe(200);
  expect(body.success).toBe(true);
  expect(body.accessToken).toBeTruthy();
  expect(body.sessionId).toBeTruthy();
  expect(body.authenticationLevel).toBe(1);
  expect(cookie).toBeTruthy();
});

test('login fails with wrong password', async ({ request }) => {
  const { statusCode, body } = await loginAs(request, baseURL, 'admin', 'wrongpass');
  expect(statusCode).toBe(401);
  expect(body.success).toBe(false);
  expect(body.error).toBe('invalid_credentials');
});

test('login fails with nonexistent user', async ({ request }) => {
  const { statusCode, body } = await loginAs(request, baseURL, 'ghost', 'anything');
  expect(statusCode).toBe(401);
  expect(body.error).toBe('invalid_credentials');
});

test('login fails with empty username', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username: '', password: 'admin123' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_request');
});

test('login fails with empty password', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username: 'admin', password: '' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_request');
});

test('login returns remaining attempts on failure', async ({ request }) => {
  const { body } = await loginAs(request, baseURL, 'admin', 'wrongpass');
  expect(body.remainingAttempts).toBeGreaterThanOrEqual(0);
});

test('GET /api/auth/session returns authenticated:false when no cookie', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/auth/session`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.authenticated).toBe(false);
  expect(body.authenticationLevel).toBe(0);
});

test('GET /api/auth/session returns session data after login', async ({ request }) => {
  const { body: loginResult, cookie } = await loginAs(request, baseURL, 'admin', 'admin123');
  const res = await request.get(`${baseURL}/api/auth/session`, {
    headers: { Cookie: cookie },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(body.session.username).toBe('admin');
  expect(body.session.groups).toContain('admin');
});

test('logout destroys session', async ({ request }) => {
  const { body: loginResult, cookie } = await loginAs(request, baseURL, 'admin', 'admin123');
  const res = await request.post(`${baseURL}/api/auth/logout`, {
    headers: { Cookie: cookie },
  });
  expect(res.status()).toBe(200);
  const logoutBody = await res.json();
  expect(logoutBody.success).toBe(true);
  expect(logoutBody.message).toBe('Logged out');
});

test('cant access session after logout with old cookie', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, 'admin', 'admin123');
  await request.post(`${baseURL}/api/auth/logout`, { headers: { Cookie: cookie } });
  const res = await request.get(`${baseURL}/api/auth/session`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  expect(body.authenticated).toBe(false);
});

test('login returns 429 after exceeding rate limit', async ({ request }) => {
  for (let i = 0; i < 11; i++) {
    await request.post(`${baseURL}/api/auth/login`, {
      data: { username: 'admin', password: 'wrongpass' },
    });
  }
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username: 'admin', password: 'wrongpass' },
  });
  expect(res.status()).toBe(429);
});

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.service).toBe('auth-service');
});
