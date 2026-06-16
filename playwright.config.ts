import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'off',
    headless: true,
  },
  projects: [
    {
      name: 'integration-chromium',
      testMatch: 'integration/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-chromium',
      testMatch: 'e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
