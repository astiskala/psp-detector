import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
