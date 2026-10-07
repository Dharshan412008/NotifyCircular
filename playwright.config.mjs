import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '.visual-check/test-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: './test/e2e-server.js',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    channel: 'msedge',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-edge',
      use: {
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile-edge',
      use: {
        ...devices['Pixel 7'],
        channel: 'msedge',
      },
    },
  ],
});
