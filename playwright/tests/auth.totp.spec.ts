import { test, expect } from '@playwright/test';
import express from 'express';
import { authenticator as otplibAuthenticator } from 'otplib/v11';
import { startTestAuthService, loginAs, createTestUser, TEST_PEPPER, TEST_JWT_SECRET } from './helpers/setup';

let app: express.Application;
let baseURL: string;
let server: any;
const TOTP_USER = 'totpuser';
const TOTP_PASS = 'totppass123';

test.beforeAll(async () => {
  const user = await createTestUser(TOTP_USER, TOTP_PASS, []);
  const state = await startTestAuthService([user]);
  app = state.app;
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;
});

test.afterAll(() => { if (server) server.close(); });

test('can enroll TOTP and get secret + URI', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, TOTP_USER, TOTP_PASS);
  const res = await request.post(`${baseURL}/api/auth/2fa/enroll`, {
    headers: { Cookie: cookie },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.secret).toBeTruthy();
  expect(body.uri).toContain('otpauth://totp/');
  expect(body.qrCodeUrl).toContain('otpauth://totp/');
});

test('can verify TOTP enrollment with valid token', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, TOTP_USER, TOTP_PASS);
  const enrollRes = await request.post(`${baseURL}/api/auth/2fa/enroll`, {
    headers: { Cookie: cookie },
  });
  const { secret } = await enrollRes.json();

  const token = otplibAuthenticator.generate(secret);
  const verifyRes = await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    headers: { Cookie: cookie },
    data: { token },
  });
  expect(verifyRes.status()).toBe(200);
  const body = await verifyRes.json();
  expect(body.success).toBe(true);
});

test('TOTP verify-enrollment fails with wrong token', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, TOTP_USER, TOTP_PASS);
  const res = await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    headers: { Cookie: cookie },
    data: { token: '000000' },
  });
  const body = await res.json();
  expect(body.error).toBe('invalid_totp');
});

test('TOTP enrollment fails without session cookie', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/2fa/enroll`);
  expect(res.status()).toBe(401);
});

test('TOTP verify-enrollment fails without session cookie', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    data: { token: '000000' },
  });
  expect(res.status()).toBe(401);
});

test('TOTP enrollment requires valid token in body', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, TOTP_USER, TOTP_PASS);
  const res = await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    headers: { Cookie: cookie },
    data: {},
  });
  expect(res.status()).toBe(400);
});

test('can authenticate with TOTP and upgrade session', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, TOTP_USER, TOTP_PASS);
  const enrollRes = await request.post(`${baseURL}/api/auth/2fa/enroll`, {
    headers: { Cookie: cookie },
  });
  const { secret } = await enrollRes.json();
  await request.post(`${baseURL}/api/auth/2fa/verify-enrollment`, {
    headers: { Cookie: cookie },
    data: { token: otplibAuthenticator.generate(secret) },
  });

  // Now authenticate with TOTP
  const totpRes = await request.post(`${baseURL}/api/auth/2fa/totp`, {
    headers: { Cookie: cookie },
    data: { token: otplibAuthenticator.generate(secret) },
  });
  expect(totpRes.status()).toBe(200);
  const body = await totpRes.json();
  expect(body.success).toBe(true);
  expect(body.authenticationLevel).toBe(2); // TwoFactor
  expect(body.accessToken).toBeTruthy();
});

test('TOTP auth fails with invalid token', async ({ request }) => {
  const { cookie } = await loginAs(request, baseURL, TOTP_USER, TOTP_PASS);
  await request.post(`${baseURL}/api/auth/2fa/enroll`, {
    headers: { Cookie: cookie },
  });
  const res = await request.post(`${baseURL}/api/auth/2fa/totp`, {
    headers: { Cookie: cookie },
    data: { token: '000000' },
  });
  expect(res.status()).toBe(401);
});

test('TOTP auth fails without session cookie', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/2fa/totp`, {
    data: { token: '000000' },
  });
  expect(res.status()).toBe(401);
});
