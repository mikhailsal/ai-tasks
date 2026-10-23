import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e',
  testMatch: ['browser-uuid-http.spec.ts', 'board-http-origin.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 60_000,
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
