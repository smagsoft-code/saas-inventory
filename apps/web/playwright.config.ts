import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: process.env['APP_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm start',
    url: process.env['APP_URL'] ?? 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
  },
});
