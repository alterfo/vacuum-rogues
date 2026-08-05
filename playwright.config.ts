import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  timeout: 90000,
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 45000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-proxy-server'],
        },
      },
      testIgnore: [
        '**/letsplay-discovery.spec.ts',
        '**/sun-band-exploration.spec.ts',
      ],
    },
    {
      name: 'letsplay',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-proxy-server'],
        },
      },
      testMatch: [
        '**/letsplay-discovery.spec.ts',
        '**/sun-band-exploration.spec.ts',
      ],
    },
    {
      name: 'regression',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-proxy-server'],
        },
      },
      testMatch: '**/playtest-regression.spec.ts',
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
