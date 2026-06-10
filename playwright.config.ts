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
      // Discovery/diagnostic harnesses are manual-only (run via the `letsplay`
      // project): they are nearly assertion-free by design (soft steps,
      // screenshot output for human inspection), so keeping them in the
      // default suite would inflate apparent coverage and silently absorb
      // scene breakage.
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
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  webServer: {
    command: 'npm run dev -- --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
