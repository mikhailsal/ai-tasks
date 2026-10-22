import { defineConfig, devices } from '@playwright/test';

const browserCaseTimeoutMs = 30_000;
const browserJobTimeoutMs = 600_000;
const baseURL = process.env.AI_TASKS_TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const serverCommand =
  process.env.AI_TASKS_TEST_SERVER_COMMAND ?? 'node tests/fixtures/browser-server.mjs';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  timeout: browserCaseTimeoutMs,
  globalTimeout: browserJobTimeoutMs,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: serverCommand,
    url: baseURL,
    reuseExistingServer: false,
    timeout: browserJobTimeoutMs,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
