import { defineConfig, devices } from '@playwright/test';

/**
 * Checks against a deployed site (never the local server). Creates fictional accounts only and
 * deletes them at the end. No traces or videos: pages can show recovery secrets.
 *   HOSTED_URL=https://reconnect-web.onrender.com npm run test:hosted
 */
const baseURL = process.env.HOSTED_URL;
if (!baseURL) throw new Error('Set HOSTED_URL to the deployed origin.');

export default defineConfig({
  testDir: 'tests/hosted',
  outputDir: 'test-results/hosted',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
});
