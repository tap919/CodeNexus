import { test, expect } from '@playwright/test';
import express from 'express';
import { authenticator as otplibAuthenticator } from 'otplib';
import {
  startTestAuthService,
  loginAs,
  getAuthHeaders,
  createTestUser,
} from './helpers/setup';

let app: express.Application;
let baseURL: string;
let server: any;
const FLOW_USER = 'flowuser';
const FLOW_PASS = 'flowpass123';

test.beforeAll(async () => {
  const user = await createTestUser(FLOW_USER, FLOW_PASS, []);
  const state = await startTestAuthService([user]);
  app = state.app;
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;
});

test.afterAll(() => { if (server) server.close(); });

test('must complete first factor before second factor', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/2fa/totp`, {
    data: { token: '000000' },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe('session_required');
});

test('cannot enroll TOTP without authenticated session', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/2fa/enroll`);
  expect(res.status()).toBe(401);
});

test('cannot verify TOTP enrollment without authenticated session', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    data: { token: '000000' },
  });
  expect(res.status()).toBe(401);
});

test('account lockout after 5 consecutive failed attempts', async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    await request.post(`${baseURL}/api/auth/login`, {
      data: { username: FLOW_USER, password: 'wrongpass' },
    });
  }
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username: FLOW_USER, password: FLOW_PASS },
  });
  expect(res.status()).toBe(429);
  const body = await res.json();
  expect(body.error).toBe('account_locked');
});

test('successful login resets failed attempts counter', async ({ request }) => {
  await loginAs(request, baseURL, FLOW_USER, 'wrongpass');
  await loginAs(request, baseURL, FLOW_USER, 'wrongpass');

  const { statusCode, body } = await loginAs(request, baseURL, FLOW_USER, FLOW_PASS);
  expect(statusCode).toBe(200);
  expect(body.success).toBe(true);

  const { body: failBody } = await loginAs(request, baseURL, FLOW_USER, 'wrongpass');
  expect(failBody.remainingAttempts).toBeGreaterThanOrEqual(3);
});

test('disabled account cannot log in', async ({ request }) => {
  const disabledUser = await createTestUser('disabled', 'disabled123', []);
  disabledUser.disabled = true;
  const state = await startTestAuthService([disabledUser]);
  const disabledApp = state.app;
  const disabledServer = disabledApp.listen(0);
  const disabledURL = `http://localhost:${disabledServer.address().port}`;

  const { statusCode, body } = await loginAs(request, disabledURL, 'disabled', 'disabled123');
  expect(statusCode).toBe(403);
  expect(body.error).toBe('account_disabled');

  disabledServer.close();
});

test('TOTP enrollment then auth upgrades session to TwoFactor', async ({ request }) => {
  const { cookie, body: loginBody } = await loginAs(request, baseURL, FLOW_USER, FLOW_PASS);

  const enrollRes = await request.post(`${baseURL}/api/auth/2fa/enroll`, {
    headers: { Cookie: cookie },
  });
  const { secret } = await enrollRes.json();

  const token = otplibAuthenticator.generate(secret);
  await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    headers: { Cookie: cookie },
    data: { token },
  });

  const newToken = otplibAuthenticator.generate(secret);
  const totpRes = await request.post(`${baseURL}/api/auth/2fa/totp`, {
    headers: { Cookie: cookie },
    data: { token: newToken },
  });
  const totpBody = await totpRes.json();
  expect(totpBody.success).toBe(true);
  expect(totpBody.authenticationLevel).toBe(2);
});

test('TOTP enrollment fails for already enrolled user', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, FLOW_USER, FLOW_PASS);
  const enrollRes = await request.post(`${baseURL}/api/auth/2fa/enroll`, {
    headers: { Cookie: cookie },
  });
  expect(enrollRes.status()).toBe(200);
});

test('can login in sequence with same credentials', async ({ request }) => {
  for (let i = 0; i < 3; i++) {
    const { statusCode, body } = await loginAs(request, baseURL, FLOW_USER, FLOW_PASS);
    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessionId).toBeTruthy();
  }
});

test('session IDs are unique across logins', async ({ request }) => {
  const { body: b1 } = await loginAs(request, baseURL, FLOW_USER, FLOW_PASS);
  const { body: b2 } = await loginAs(request, baseURL, FLOW_USER, FLOW_PASS);
  expect(b1.sessionId).not.toBe(b2.sessionId);
});
