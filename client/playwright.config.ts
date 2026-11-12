import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w server',
      // /ready waits for Mongo; /health can pass before the first Atlas connect completes.
      url: 'http://localhost:5000/ready',
      // E2E may reuse an already-running API. When Playwright starts the server,
      // disable auth rate limits so multi-role suites are not flaky.
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      cwd: '..',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DISABLE_AUTH_RATE_LIMIT: '1',
        SERVE_WEB: 'false'
      }
    },
    {
      command: 'npm run dev -w client',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      cwd: '..'
    }
  ]
});
