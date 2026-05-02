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

let authApp: express.Application;
let analyticsApp: express.Application;
let authURL: string;
let analyticsURL: string;
let authServer: any;
let analyticsServer: any;
let adminToken: string;

test.beforeAll(async ({ request }) => {
  const adminUser = await createTestUser('admin', 'admin123', ['admin']);
  const viewerUser = await createTestUser('viewer', 'viewer123', ['viewer']);
  const authState = await startTestAuthService([adminUser, viewerUser]);
  authApp = authState.app;
  authServer = authApp.listen(0);
  authURL = `http://localhost:${authServer.address().port}`;

  // Start analytics on separate port
  const { router } = startTestAnalytics();
  analyticsApp = express();
  analyticsApp.use(express.json());
  analyticsApp.use('/api/analytics', router);
  analyticsServer = analyticsApp.listen(0);
  analyticsURL = `http://localhost:${analyticsServer.address().port}`;

  // Get admin token using Playwright's request fixture
  const { body } = await loginAs(request, authURL, 'admin', 'admin123');
  adminToken = body.accessToken;
});

test.afterAll(() => {
  if (authServer) authServer.close();
  if (analyticsServer) analyticsServer.close();
});

test('analytics dashboard requires Bearer token', async ({ request }) => {
  const res = await request.get(`${analyticsURL}/api/analytics/dashboard`);
  expect(res.status()).toBe(401);
});

test('analytics /clear requires admin group', async ({ request }) => {
  const { body: viewerLogin } = await loginAs(request, authURL, 'viewer', 'viewer123');
  const res = await request.post(`${analyticsURL}/api/analytics/clear`, {
    headers: getAuthHeaders(viewerLogin.accessToken),
  });
  expect(res.status()).toBe(403);
});

test('admin can clear analytics data', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/clear`, {
    headers: getAuthHeaders(adminToken),
  });
  expect(res.status()).toBe(200);
});

test('analytics /metric requires Bearer token', async ({ request }) => {
  const res = await request.post(`${analyticsURL}/api/analytics/metric`, {
    data: { prNumber: 1, repository: 'test/repo' },
  });
  expect(res.status()).toBe(401);
});

test('analytics /events requires Bearer token', async ({ request }) => {
  const res = await request.get(`${analyticsURL}/api/analytics/events`);
  expect(res.status()).toBe(401);
});

test('JWT with invalid issuer is rejected on analytics', async ({ request }) => {
  const jwt = require('jsonwebtoken');
  const badToken = jwt.sign({ sub: 'admin', groups: ['admin'] }, TEST_JWT_SECRET, {
    algorithm: 'HS256', issuer: 'https://evil.local', audience: 'codenexus-api',
  });
  const res = await request.get(`${analyticsURL}/api/analytics/dashboard`, {
    headers: getAuthHeaders(badToken),
  });
  expect(res.status()).toBe(401);
});

test('expired JWT is rejected on analytics', async ({ request }) => {
  const jwt = require('jsonwebtoken');
  const expiredToken = jwt.sign({ sub: 'admin', groups: ['admin'] }, TEST_JWT_SECRET, {
    algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'codenexus-api', expiresIn: '0s',
  });
  await new Promise(r => setTimeout(r, 1000));
  const res = await request.get(`${analyticsURL}/api/analytics/dashboard`, {
    headers: getAuthHeaders(expiredToken),
  });
  expect(res.status()).toBe(401);
});

test('valid JWT accesses analytics dashboard', async ({ request }) => {
  const res = await request.get(`${analyticsURL}/api/analytics/dashboard`, {
    headers: getAuthHeaders(adminToken),
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.totalPRsReviewed).toBe(0);
  expect(body.totalFixesApplied).toBe(0);
});
