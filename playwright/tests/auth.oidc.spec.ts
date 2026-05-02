import { test, expect } from '@playwright/test';
import express from 'express';
import { startTestAuthService, loginAs, getAuthHeaders, TEST_ISSUER } from './helpers/setup';

let app: express.Application;
let baseURL: string;
let server: any;

test.beforeAll(async () => {
  const state = await startTestAuthService();
  app = state.app;
  server = app.listen(0);
  baseURL = `http://localhost:${server.address().port}`;
});

test.afterAll(() => { if (server) server.close(); });

test('discovery document returns valid OIDC config', async ({ request }) => {
  const res = await request.get(`${baseURL}/.well-known/openid-configuration`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.issuer).toBe(TEST_ISSUER);
  expect(body.token_endpoint).toContain('/oidc/token');
  expect(body.userinfo_endpoint).toContain('/oidc/userinfo');
  expect(body.jwks_uri).toContain('/oidc/jwks');
  expect(body.scopes_supported).toContain('openid');
  expect(body.grant_types_supported).toContain('client_credentials');
  expect(body.id_token_signing_alg_values_supported).toContain('HS256');
});

test('POST /oidc/token with client_credentials returns access token', async ({ request }) => {
  const res = await request.post(`${baseURL}/oidc/token`, {
    data: {
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'test-client-secret',
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.access_token).toBeTruthy();
  expect(body.token_type).toBe('Bearer');
  expect(body.expires_in).toBeGreaterThan(0);
});

test('POST /oidc/token fails with invalid client secret', async ({ request }) => {
  const res = await request.post(`${baseURL}/oidc/token`, {
    data: {
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'wrong-secret',
    },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe('invalid_client');
});

test('POST /oidc/token fails with unknown client', async ({ request }) => {
  const res = await request.post(`${baseURL}/oidc/token`, {
    data: {
      grant_type: 'client_credentials',
      client_id: 'unknown-client',
      client_secret: 'anything',
    },
  });
  expect(res.status()).toBe(401);
});

test('POST /oidc/token fails with unsupported grant type', async ({ request }) => {
  const res = await request.post(`${baseURL}/oidc/token`, {
    data: {
      grant_type: 'password',
      client_id: 'test-client',
      client_secret: 'test-client-secret',
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('unsupported_grant_type');
});

test('POST /oidc/token is rate limited', async ({ request }) => {
  for (let i = 0; i < 6; i++) {
    await request.post(`${baseURL}/oidc/token`, {
      data: { grant_type: 'client_credentials', client_id: 'test-client', client_secret: 'wrong' },
    });
  }
  const res = await request.post(`${baseURL}/oidc/token`, {
    data: { grant_type: 'client_credentials', client_id: 'test-client', client_secret: 'wrong' },
  });
  expect(res.status()).toBe(429);
});

test('GET /oidc/userinfo returns claims for valid token', async ({ request }) => {
  const { body: loginResult } = await loginAs(request, baseURL, 'admin', 'admin123');
  const res = await request.get(`${baseURL}/oidc/userinfo`, {
    headers: getAuthHeaders(loginResult.accessToken),
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.sub).toBe('admin');
  expect(body.email_verified).toBe(true);
});

test('GET /oidc/userinfo returns 401 for missing token', async ({ request }) => {
  const res = await request.get(`${baseURL}/oidc/userinfo`);
  expect(res.status()).toBe(401);
});

test('GET /oidc/userinfo returns 401 for invalid token', async ({ request }) => {
  const res = await request.get(`${baseURL}/oidc/userinfo`, {
    headers: { Authorization: 'Bearer invalid.jwt.token' },
  });
  expect(res.status()).toBe(401);
});

test('GET /oidc/jwks returns keys array', async ({ request }) => {
  const res = await request.get(`${baseURL}/oidc/jwks`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.keys).toBeInstanceOf(Array);
});

test('POST /api/auth/token/refresh returns new tokens', async ({ request }) => {
  const { body: loginResult } = await loginAs(request, baseURL, 'admin', 'admin123');
  expect(loginResult.refreshToken).toBeTruthy();
  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: loginResult.refreshToken },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.access_token).toBeTruthy();
  expect(body.refresh_token).toBeTruthy();
  expect(body.token_type).toBe('Bearer');
});

test('POST /api/auth/token/refresh with invalid token returns 401', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: 'invalid.refresh.token' },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe('invalid_token');
});

test('POST /api/auth/token/refresh rotates refresh token', async ({ request }) => {
  const { body: loginResult } = await loginAs(request, baseURL, 'admin', 'admin123');
  const res = await request.post(`${baseURL}/api/auth/token/refresh`, {
    data: { refresh_token: loginResult.refreshToken },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.refresh_token).toBeTruthy();
  expect(body.refresh_token).not.toBe(loginResult.refreshToken);
});
