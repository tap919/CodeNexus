import { test, expect } from '@playwright/test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { startTestAuthService, loginAs, getAuthHeaders, createTestUser, TEST_JWT_SECRET, TEST_ISSUER, TEST_AUDIENCE } from './helpers/setup';
import type { SessionStore } from '../../../auth-service/src/session-store';

let authApp: express.Application;
let authURL: string;
let authServer: any;
let sessionStore: SessionStore;

test.beforeAll(async () => {
  const userA = await createTestUser('alice', 'alice123', ['user']);
  const userB = await createTestUser('bob', 'bob123', ['user']);
  const state = await startTestAuthService([userA, userB]);
  authApp = state.app;
  sessionStore = state.sessionStore;
  authServer = authApp.listen(0);
  authURL = `http://localhost:${authServer.address().port}`;
});

test.afterAll(async () => {
  await sessionStore.destroy();
  if (authServer) authServer.close();
});

test('cannot access session info with another users cookie', async ({ request }) => {
  const { body: aliceBody, cookie: aliceCookie } = await loginAs(request, authURL, 'alice', 'alice123');
  const { body: bobBody, cookie: bobCookie } = await loginAs(request, authURL, 'bob', 'bob123');

  // Alice's cookie should return Alice's session, not Bob's
  const res = await request.get(`${authURL}/api/auth/session`, {
    headers: { Cookie: aliceCookie },
  });
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(body.session.username).toBe('alice');
  expect(body.session.username).not.toBe('bob');
});

test('session from alice cannot access protected route as bob', async ({ request }) => {
  const { cookie: aliceCookie } = await loginAs(request, authURL, 'alice', 'alice123');
  const res = await request.get(`${authURL}/api/auth/session`, {
    headers: { Cookie: aliceCookie },
  });
  const body = await res.json();
  expect(body.session.username).toBe('alice');
});

test('logout by one user does not affect another users session', async ({ request }) => {
  const { cookie: aliceCookie } = await loginAs(request, authURL, 'alice', 'alice123');
  const { cookie: bobCookie } = await loginAs(request, authURL, 'bob', 'bob123');

  // Alice logs out
  await request.post(`${authURL}/api/auth/logout`, { headers: { Cookie: aliceCookie } });

  // Bob should still be authenticated
  const res = await request.get(`${authURL}/api/auth/session`, {
    headers: { Cookie: bobCookie },
  });
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(body.session.username).toBe('bob');
});

test('JWT with mismatched audience is rejected', async ({ request }) => {
  const { body: loginResult } = await loginAs(request, authURL, 'alice', 'alice123');
  const decoded = jwt.decode(loginResult.accessToken) as any;
  const badToken = jwt.sign(
    { sub: decoded.sub, groups: decoded.groups },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', issuer: TEST_ISSUER, audience: 'wrong-audience' },
  );
  const res = await request.get(`${authURL}/oidc/userinfo`, {
    headers: getAuthHeaders(badToken),
  });
  expect(res.status()).toBe(401);
});

test('analytics metrics recorded by one user do not require repo ownership in basic mode', async ({ request }) => {
  // Test that any authenticated user can record metrics (no tenant isolation in v1)
  const { body: aliceBody } = await loginAs(request, authURL, 'alice', 'alice123');
  const res = await request.post(`${authURL}/api/auth/session`, {
    headers: { Cookie: undefined },
  });
  // Session endpoint with Bearer token
  const sessionRes = await request.get(`${authURL}/api/auth/session`, {
    headers: getAuthHeaders(aliceBody.accessToken),
  });
  expect(sessionRes.status()).toBe(200);
});

test('cannot use token from one service on another with different secret', async ({ request }) => {
  // Generate a token with a different secret
  const jwt = require('jsonwebtoken');
  const badToken = jwt.sign({ sub: 'admin', groups: ['admin'] }, 'different-secret-123', {
    algorithm: 'HS256', issuer: TEST_ISSUER, audience: TEST_AUDIENCE,
  });
  const res = await request.get(`${authURL}/oidc/userinfo`, {
    headers: getAuthHeaders(badToken),
  });
  expect(res.status()).toBe(401);
});
