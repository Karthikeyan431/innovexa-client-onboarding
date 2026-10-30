import { defineConfig, devices } from '@playwright/test';

// Requires the local stack running (see README → Local development).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    channel: 'chrome', // use the installed Google Chrome
    navigationTimeout: 120_000,
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 }, channel: 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, testMatch: /onboarding\.spec/ },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'], channel: 'chrome' }, testMatch: /responsive\.spec/ },
  ],
});
