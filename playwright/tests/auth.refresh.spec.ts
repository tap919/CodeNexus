import { test, expect } from '@playwright/test';
import express from 'express';
import {
  startTestAuthService,
  loginAs,
  getAuthHeaders,
  createTestUser,
  TEST_JWT_SECRET,
} from './helpers/setup';
import type { SessionStore } from '../../../auth-service/src/session-store';

let app: express.Application;
let baseURL: string;
let server: any;
let sessionStore: SessionStore;

test.beforeAll(async () => {
  const user = await createTestUser('refreshuser', 'refresh123', ['user']);
  const state = await startTestAuthService([user]);
  app = state.app;
  sessionStore = state.sessionStore;
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;
});

test.afterAll(async () => {
  await sessionStore.destroy();
  if (server) server.close();
});

test('login returns refreshToken alongside accessToken', async ({ request }) => {
  const { statusCode, body } = await loginAs(request, baseURL, 'refreshuser', 'refresh123');

  expect(statusCode).toBe(200);
  expect(body.success).toBe(true);
  expect(body.accessToken).toBeTruthy();
  expect(body.refreshToken).toBeTruthy();
  expect(typeof body.accessToken).toBe('string');
  expect(typeof body.refreshToken).toBe('string');
  expect(body.refreshToken).not.toBe(body.accessToken);
});

test('POST /api/auth/token/refresh with valid refresh token returns new access token', async ({ request }) => {
  const { body } = await loginAs(request, baseURL, 'refreshuser', 'refresh123');
  const refreshToken = body.refreshToken;

  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: refreshToken },
  });

  expect(res.status()).toBe(200);
  const refreshBody = await res.json();
  expect(refreshBody.access_token).toBeTruthy();
  expect(refreshBody.refresh_token).toBeTruthy();
  expect(refreshBody.token_type).toBe('Bearer');
  expect(refreshBody.expires_in).toBeGreaterThan(0);
});

test('POST /api/auth/token/refresh with invalid/expired refresh token returns 401', async ({ request }) => {
  const jwt = require('jsonwebtoken');
  const badToken = jwt.sign(
    { sub: 'refreshuser', session_id: 'nonexistent', token_type: 'refresh' },
    TEST_JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'https://test.local',
      audience: 'codenexus-api',
      expiresIn: '1s',
    },
  );
  await new Promise(r => setTimeout(r, 1500));

  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: badToken },
  });

  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe('invalid_token');
});

test('POST /api/auth/token/refresh with missing refresh_token returns 400', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: {},
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_request');
  expect(body.message).toContain('refresh_token');
});

test('refresh token rotation: new refresh token differs from old one', async ({ request }) => {
  const { body } = await loginAs(request, baseURL, 'refreshuser', 'refresh123');
  const oldRefreshToken = body.refreshToken;
  const oldAccessToken = body.accessToken;

  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: oldRefreshToken },
  });

  expect(res.status()).toBe(200);
  const refreshBody = await res.json();

  expect(refreshBody.access_token).toBeTruthy();
  expect(refreshBody.refresh_token).toBeTruthy();
  expect(refreshBody.refresh_token).not.toBe(oldRefreshToken);
  expect(refreshBody.access_token).not.toBe(oldAccessToken);
});

test('old access token still works during its validity window', async ({ request }) => {
  const { body } = await loginAs(request, baseURL, 'refreshuser', 'refresh123');
  const oldAccessToken = body.accessToken;
  const refreshToken = body.refreshToken;

  const refreshRes = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: refreshToken },
  });
  expect(refreshRes.status()).toBe(200);

  const sessionRes = await request.get(`${baseURL}/api/auth/session`, {
    headers: getAuthHeaders(oldAccessToken),
  });
  expect(sessionRes.status()).toBe(200);
  const sessionBody = await sessionRes.json();
  expect(sessionBody.authenticated).toBe(true);
  expect(sessionBody.session.username).toBe('refreshuser');
});
