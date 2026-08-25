import { defineConfig, devices } from '@playwright/test'

// GMAIL_PROVIDER defaults to 'mock' (see server/config/env.js), so the dev
// server started here never talks to real Google/Gmail - matches the "no
// real Gmail credentials in CI" requirement. The mock provider also binds
// every mock sign-in to one fixed backend account (server/app.js's
// userId = 'mock-user'), so each selected Playwright project remains serial
// internally. CI parallelism is provided at the GitHub Actions job level,
// where every project gets its own isolated runner/server process.
//
// Kept as a separate config file from the critical Chromium smoke suite so
// ordinary PR validation does not start this broader browser matrix at all.
//
// #43 Accessibility & Cross-Browser QA Gate: this suite covers the approved
// automated engine matrix - Chromium (Chrome/Edge family), Firefox, and
// WebKit (Safari family) - across desktop and responsive mobile profiles.
// WebKit automation is evidence only and must never be reported as real
// Safari macOS/iOS PASS; real Safari/iOS/Android evidence remains mandatory
// manual #43 evidence (see docs/quality/ACCESSIBILITY_QA.md).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Retain a modest CI assertion cushion for runner variance, but browser
  // engines no longer contend with Postgres + every other engine in one
  // serial job. Deterministic product/accessibility failures must surface.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  fullyParallel: false,
  workers: 1,
  // Browser projects now execute on isolated runners. One retry is enough to
  // absorb an occasional runner/transient startup hiccup without tripling the
  // cost of deterministic accessibility or product failures.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      GMAIL_PROVIDER: 'mock',
      PERSISTENCE_PROVIDER: 'memory',
      MOCK_GMAIL_SCENARIO: 'success',
      // The full browser suite creates many short-lived sessions from one
      // loopback IP. Use a test-only ceiling so responsive/a11y coverage does
      // not accidentally test the production rate limiter instead. The server
      // honors this override only when NODE_ENV=test; production remains 60/min.
      NODE_ENV: 'test',
      E2E_RATE_LIMIT: '10000',
      // Keep this suite on a distinct backend port from the Chromium smoke
      // config so local/manual invocations cannot collide if both are run.
      PORT: '8788',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:8788',
    },
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.js/,
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 15'] },
      testMatch: /responsive\.spec\.js/,
    },
  ],
})
