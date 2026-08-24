import { defineConfig, devices } from '@playwright/test'

// GMAIL_PROVIDER defaults to 'mock' (see server/config/env.js), so the dev
// server started here never talks to real Google/Gmail - matches the "no
// real Gmail credentials in CI" requirement. The mock provider also binds
// every mock sign-in to one fixed backend account (server/app.js's
// userId = 'mock-user'), so this suite must stay fully serial - concurrent
// workers or projects would race against the same account's connection/
// subscription state.
//
// Kept as a separate config file (rather than merged into the top-level
// playwright.config.js alongside the test/e2e/ smoke suite) so that running
// either suite only ever starts the dev server(s) that suite actually needs.
// Playwright starts every entry in a config's `webServer` array up front,
// regardless of which `--project` is selected - a shared config would make
// `npm run test:smoke` also boot this suite's dev server on every CI run,
// for nothing, competing for CPU with the servers it actually uses.
//
// #43 Accessibility & Cross-Browser QA Gate: this suite additionally covers
// the product-approved browser matrix's rendering/runtime engines - Chromium
// (Chrome/Edge), Firefox, and WebKit (Safari family) - across desktop and a
// mobile responsive profile. WebKit here is automation evidence only and
// must never be reported as real Safari macOS/iOS PASS; real Safari/Android
// evidence remains mandatory manual #43 evidence (see
// docs/quality/ACCESSIBILITY_QA.md).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
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
      // A distinct backend port from the smoke suite's hardcoded 8787
      // (playwright.config.js), not the shared server/config/env.js default -
      // CI now runs both suites sequentially in one job
      // (.github/workflows/ci.yml), and reusing 8787 here risked this suite's
      // backend racing the smoke suite's not-yet-released port and failing to
      // bind, which silently broke every test in this suite (every page load
      // showed the app's own "couldn't reach the server" error state instead
      // of real content - see vite.config.js).
      PORT: '8788',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:8788',
    },
  },
  projects: [
    // Desktop engines representing the supported Chrome/Edge (Chromium),
    // Firefox, and Safari-family (WebKit) rendering/runtime engines. WebKit is
    // automation evidence only and must never be reported as real Safari PASS.
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

    // Mobile engine coverage is intentionally limited to the non-destructive
    // responsive suite while the mock backend uses one shared account. Real
    // Android Chrome and real iOS Safari remain mandatory manual #43 evidence.
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
