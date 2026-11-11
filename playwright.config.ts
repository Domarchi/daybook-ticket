import { defineConfig, devices } from '@playwright/test';
import {
  ASSISTANT_DAILY_LIMIT,
  BASE_URL,
  DATABASE_URL,
  E2E_PORT,
  FAKE_ANTHROPIC_URL,
  OWNER_EMAIL,
  OWNER_SESSION,
} from './e2e/support/env';

/**
 * Browser tests against a built app (`next start`) and a disposable local PostgreSQL. No provider, mail or push
 * service is configured, so nothing real can be reached. Run `npm run build` first, then `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './test-results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // The desk tests build on each other's data, so a retry would repeat steps on a changed database: fail honestly.
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The runner image and developer machines both ship Chrome; no browser download is needed.
    channel: 'chrome',
  },
  projects: [
    { name: 'anonymous', testMatch: /anonymous\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'setup', testMatch: /owner\.setup\.ts/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    {
      name: 'desktop',
      testMatch: /desk\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: OWNER_SESSION },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      dependencies: ['desktop'],
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
        storageState: OWNER_SESSION,
      },
    },
    {
      // Bita, the staff assistant, against a local fake of the Anthropic API (see e2e/tests/bita.spec.ts).
      name: 'bita',
      testMatch: /bita\.spec\.ts/,
      dependencies: ['mobile'],
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: OWNER_SESSION },
    },
    {
      name: 'session',
      testMatch: /session\.spec\.ts/,
      dependencies: ['bita'],
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: `npx next start --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL,
      BETTER_AUTH_SECRET: 'daybook-e2e-disposable-secret-not-for-production',
      DAYBOOK_SITE_URL: BASE_URL,
      DAYBOOK_OWNER_EMAIL: OWNER_EMAIL,
      // Bita is on for the browser tests only, pointed at a local fake: no real key and no real API call exist here.
      ASSISTANT_ENABLED: '1',
      ANTHROPIC_API_KEY: 'e2e-fake-key-not-a-real-credential',
      ANTHROPIC_BASE_URL: FAKE_ANTHROPIC_URL,
      ASSISTANT_DAILY_LIMIT: String(ASSISTANT_DAILY_LIMIT),
    },
  },
});
