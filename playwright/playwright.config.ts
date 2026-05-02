import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'auth',
      testMatch: /auth\.\w+\.spec\.ts/,
    },
    {
      name: 'authz',
      testMatch: /authz\.\w+\.spec\.ts/,
    },
    {
      name: 'logic',
      testMatch: /logic\.\w+\.spec\.ts/,
    },
    {
      name: 'race',
      testMatch: /race\.\w+\.spec\.ts/,
    },
    {
      name: 'recovery',
      testMatch: /recovery\.\w+\.spec\.ts/,
    },
    {
      name: 'integration',
      testMatch: /integration\.\w+\.spec\.ts/,
    },
  ],
});
