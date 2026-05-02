import { test, expect } from '@playwright/test';
import express from 'express';
import { createNodeApp } from '../../../control-plane/src/node-adapter';

let app: express.Application;
let baseURL: string;
let server: any;

test.beforeAll(() => {
  process.env.CNX_GITHUB_WEBHOOK_SECRET = 'test-wh-secret-123';
  app = createNodeApp();
  server = app.listen(0);
  baseURL = `http://localhost:${(server.address() as any).port}`;
});

test.afterAll(() => { if (server) server.close(); });

test('GET /health returns ok with node mode', async ({ request }) => {
  const res = await request.get(`${baseURL}/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.mode).toBe('node-adapter');
  expect(typeof body.activeRuns).toBe('number');
});

test('POST /api/webhooks/github accepts valid PR event', async ({ request }) => {
  const payload = {
    action: 'opened',
    pull_request: { number: 42, head: { ref: 'feature/test' } },
    repository: { full_name: 'test/repo' },
  };
  const res = await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'pull_request',
      'x-github-delivery': 'del-123',
    },
    data: payload,
  });
  expect(res.status()).toBe(202);
  const body = await res.json();
  expect(body.message).toContain('Webhook received');
  expect(body.sessionId).toBeTruthy();
  expect(body.deliveryId).toBe('del-123');
});

test('POST /api/webhooks/github rejects invalid signature', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': 'sha256=invalid',
    },
    data: { action: 'opened', pull_request: { number: 1, head: { ref: 'test' } }, repository: { full_name: 'test/repo' } },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/webhooks/github ignores non-PR events', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'push',
    },
    data: { ref: 'refs/heads/main' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.event).toBe('push');
});

test('POST /api/webhooks/github with signature', async ({ request }) => {
  const crypto = require('node:crypto');
  const payload = { action: 'opened', pull_request: { number: 10, head: { ref: 'test' } }, repository: { full_name: 'a/b' } };
  const body = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'test-wh-secret-123').update(body).digest('hex');
  
  const res = await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'pull_request',
      'x-github-delivery': 'del-signed',
      'x-hub-signature-256': sig,
    },
    data: payload,
  });
  expect(res.status()).toBe(202);
  const resBody = await res.json();
  expect(resBody.deliveryId).toBe('del-signed');
});

test('GET /api/workflows/runs returns list', async ({ request }) => {
  // Trigger a PR event first to create a run
  await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'pull_request',
    },
    data: { action: 'opened', pull_request: { number: 99, head: { ref: 't' } }, repository: { full_name: 'x/y' } },
  });

  const res = await request.get(`${baseURL}/api/workflows/runs`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.count).toBe('number');
  expect(Array.isArray(body.runs)).toBe(true);
});

test('GET /api/workflows/runs/:runId returns run details', async ({ request }) => {
  const create = await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'pull_request',
    },
    data: { action: 'opened', pull_request: { number: 50, head: { ref: 'feat' } }, repository: { full_name: 'r/r' } },
  });
  const { sessionId } = await create.json();

  const res = await request.get(`${baseURL}/api/workflows/runs/${sessionId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.id).toBe(sessionId);
  expect(Array.isArray(body.steps)).toBe(true);
  expect(Array.isArray(body.events)).toBe(true);
});

test('GET /api/workflows/runs/:runId returns 404 for unknown run', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/workflows/runs/nonexistent`);
  expect(res.status()).toBe(404);
});

test('POST /api/workflows/runs/:runId/cancel cancels run', async ({ request }) => {
  const create = await request.post(`${baseURL}/api/webhooks/github`, {
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'pull_request',
    },
    data: { action: 'opened', pull_request: { number: 51, head: { ref: 'cancel-me' } }, repository: { full_name: 't/t' } },
  });
  const { sessionId } = await create.json();

  const res = await request.post(`${baseURL}/api/workflows/runs/${sessionId}/cancel`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.message).toContain('Cancellation requested');
});

test('POST /api/workflows/runs/:runId/cancel returns 404 for unknown', async ({ request }) => {
  const res = await request.post(`${baseURL}/api/workflows/runs/ghost/cancel`);
  expect(res.status()).toBe(404);
});

test('GET /api/session/:sessionId works in local mode', async ({ request }) => {
  const res = await request.get(`${baseURL}/api/session/test-123`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.sessionId).toBe('test-123');
  expect(body.status).toBe('local-mode');
});
