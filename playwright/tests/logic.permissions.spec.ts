import { test, expect } from '@playwright/test';
import express from 'express';
import {
  startTestAuthService,
  loginAs,
  getAuthHeaders,
  createTestUser,
  TEST_JWT_SECRET,
  TEST_ISSUER,
} from './helpers/setup';
import { Policy } from '../../../shared/src/types';

let app: express.Application;
let baseURL: string;
let server: any;
let adminToken: string;
let viewerToken: string;

test.beforeAll(async ({ request }) => {
  const adminUser = await createTestUser('permadmin', 'permadmin123', ['admin']);
  const viewerUser = await createTestUser('permviewer', 'permviewer123', ['viewer']);
  const state = await startTestAuthService([adminUser, viewerUser]);
  app = state.app;
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;

  const { body: adminBody } = await loginAs(request, baseURL, 'permadmin', 'permadmin123');
  adminToken = adminBody.accessToken;

  const { body: viewerBody } = await loginAs(request, baseURL, 'permviewer', 'permviewer123');
  viewerToken = viewerBody.accessToken;
});

test.afterAll(() => {
  if (server) server.close();
});

test('unauthenticated request to /api/protected returns 403', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/protected`);

  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('access_denied');
});

test('authenticated user without admin group cannot access default-deny-scoped endpoints', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/protected`, {
    headers: getAuthHeaders(viewerToken),
  });

  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('access_denied');
});

test('admin user also denied when no access control rules match', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/protected`, {
    headers: getAuthHeaders(adminToken),
  });

  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('access_denied');
});

test('JWT with invalid signature is rejected at /api/protected', async ({ request }) => {
  const jwt = require('jsonwebtoken');
  const badToken = jwt.sign(
    { sub: 'permviewer', groups: ['admin'], session_id: 'fake-id' },
    'wrong-secret-key',
    { algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'codenexus-api' },
  );

  const res = await request.get(`${baseURL}/api/protected`, {
    headers: getAuthHeaders(badToken),
  });

  expect(res.status()).toBe(403);
});

test('JWT with missing groups claim returns 403', async ({ request }) => {
  const jwt = require('jsonwebtoken');
  const noGroupsToken = jwt.sign(
    { sub: 'permviewer', session_id: 'no-groups-id' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'codenexus-api' },
  );

  const res = await request.get(`${baseURL}/api/protected`, {
    headers: getAuthHeaders(noGroupsToken),
  });

  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('access_denied');
});

test('JWT with mismatched groups is handled correctly (no bypass)', async ({ request }) => {
  const jwt = require('jsonwebtoken');
  const mismatchedToken = jwt.sign(
    { sub: 'permviewer', groups: ['nonexistent'], session_id: 'mismatch-id' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'codenexus-api' },
  );

  const res = await request.get(`${baseURL}/api/protected`, {
    headers: getAuthHeaders(mismatchedToken),
  });

  expect(res.status()).toBe(403);
});

test('health endpoint is accessible without auth', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('login still works after multiple rejected /api/protected attempts', async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    await request.get(`${baseURL}/api/protected`);
  }

  const { statusCode, body } = await loginAs(request, baseURL, 'permviewer', 'permviewer123');
  expect(statusCode).toBe(200);
  expect(body.success).toBe(true);
});
