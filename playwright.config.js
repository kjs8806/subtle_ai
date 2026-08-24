import { defineConfig, devices } from '@playwright/test'

// GMAIL_PROVIDER defaults to 'mock' (see server/config/env.js), so the dev
// server started here never talks to real Google/Gmail - matches the "no
// real Gmail credentials in CI" requirement. The mock provider also binds
// every mock sign-in to one fixed backend account (server/app.js's
// userId = 'mock-user'), so this suite must stay fully serial - concurrent
// workers or projects would race against the same account's connection/
// subscription state.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { GMAIL_PROVIDER: 'mock', PERSISTENCE_PROVIDER: 'memory', MOCK_GMAIL_SCENARIO: 'success' },
  },
  projects: [
    // The full connect/scan/disconnect golden path only needs to prove the
    // flow works once - it mutates the one shared mock account, so it runs
    // on a single project. Responsive checks run on both, since they're the
    // part C1-C4 actually cares about per-viewport.
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.js/ },
  ],
})
