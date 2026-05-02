import { test, expect } from '@playwright/test';
import express from 'express';
import * as crypto from 'node:crypto';
import { startTestAuthService, loginAs, createTestUser, TEST_PEPPER, TEST_JWT_SECRET } from './helpers/setup';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str: string): Buffer {
  str = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  const bits: number[] = [];
  for (const char of str) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) throw new Error('Invalid base32 character');
    bits.push(val >> 4 & 1, val >> 3 & 1, val >> 2 & 1, val >> 1 & 1, val & 1);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    bytes.push((bits[i] << 7) | (bits[i + 1] << 6) | (bits[i + 2] << 5) | (bits[i + 3] << 4) |
               (bits[i + 4] << 3) | (bits[i + 5] << 2) | (bits[i + 6] << 1) | bits[i + 7]);
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret: string, digits = 6, period = 30): string {
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

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

  const token = generateTOTP(secret);
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
    data: { token: generateTOTP(secret) },
  });

  // Now authenticate with TOTP
  const totpRes = await request.post(`${baseURL}/api/auth/2fa/totp`, {
    headers: { Cookie: cookie },
    data: { token: generateTOTP(secret) },
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
