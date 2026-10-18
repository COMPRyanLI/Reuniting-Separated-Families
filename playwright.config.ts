import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error('Run browser tests through `npm run test:e2e` (it starts a real database, API and worker).');
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  // One worker: staff TOTP enrollment state and replay-protected time steps are per account.
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Staff sign-ins may wait up to 30 s for a fresh TOTP step (replay protection is per account).
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
