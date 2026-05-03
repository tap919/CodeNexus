import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const CONTROL_PLANE_DIR = path.join(ROOT, 'control-plane');
const BASE = 'http://localhost:8787';

let server: ChildProcess | null = null;

test.beforeAll(async () => {
  server = spawn('pnpm', ['run', 'dev:node'], {
    cwd: CONTROL_PLANE_DIR,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env },
  });

  server.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
  server.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

  // Wait for the server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        console.log('[e2e] Server is ready');
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Server failed to start within 30s');
}, 60000);

test.afterAll(async () => {
  if (server) {
    server.kill('SIGTERM');
    // Force kill on Windows after a short delay
    setTimeout(() => server?.kill('SIGKILL'), 3000);
  }
});

test('root endpoint returns status page', async ({ page }) => {
  const response = await page.goto(BASE);
  expect(response?.status()).toBe(200);
  const body = await response?.json();
  expect(body).toHaveProperty('service');
  expect(body).toHaveProperty('status', 'running');
});

test('health endpoint returns ok', async ({ page }) => {
  const response = await page.goto(`${BASE}/health`);
  expect(response?.status()).toBe(200);
  const body = await response?.json();
  expect(body).toHaveProperty('status', 'ok');
  expect(body).toHaveProperty('service', 'control-plane');
  expect(body).toHaveProperty('mode', 'node-adapter');
  expect(body).toHaveProperty('activeRuns');
});

test('webhook endpoint returns 401 when secret not configured', async ({ page }) => {
  const response = await page.request.post(`${BASE}/api/webhooks/github`, {
    data: { action: 'opened', pull_request: { number: 1 } },
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.error).toBe('webhook_secret_not_configured');
});

test('page title and content render correctly', async ({ page }) => {
  const response = await page.goto(`${BASE}/health`);
  const text = await response?.text();
  expect(text).toContain('control-plane');
});
