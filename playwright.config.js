import { defineConfig, devices } from '@playwright/test'

// Two independent Playwright suites share this config:
//  - test/e2e/**  (QA browser smoke suite, PR #35): per-test isolated mock
//    identity (server/gmail/fakeProvider.js mints a fresh mock-success:<uuid>
//    subject on every real "Continue with Google" click), desktop/mobile
//    tag-scoped projects, served on port 4173.
//  - e2e/**  (MVP beta onboarding/responsive suite, #39/#40/#42): served on
//    the default Vite dev port 5173.
// Both point at the same backend (port 8787, GMAIL_PROVIDER=mock,
// PERSISTENCE_PROVIDER=memory) via vite.config.js's /api proxy, so only one
// backend webServer entry is declared; each suite gets its own frontend
// dev-server entry so the two never contend for the same port.
export default defineConfig({
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node server/app.js',
      url: 'http://127.0.0.1:8787/api/v1/health',
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '8787',
        GMAIL_PROVIDER: 'mock',
        PERSISTENCE_PROVIDER: 'memory',
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'vite --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'vite --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'desktop-chromium',
      testDir: './test/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
      // @mobile-tagged tests exercise mobile-only layout (the slide-out menu,
      // viewport-dependent affordances) and have no meaningful desktop
      // equivalent - they belong solely to the mobile project below.
      // @critical and untagged tests still run here.
      grepInvert: /@mobile/,
    },
    {
      name: 'mobile-chromium',
      testDir: './test/e2e',
      use: { ...devices['Pixel 5'], baseURL: 'http://127.0.0.1:4173' },
      // Only @mobile (mobile-specific) and @critical (must pass on both
      // viewports) tests run here - untagged tests are covered once by
      // desktop and don't need a second, viewport-identical run.
      grep: /@mobile|@critical/,
    },
    {
      // The full connect/scan/disconnect golden path only needs to prove the
      // flow works once - it runs on a single project. Responsive checks run
      // on both, since they're the part C1-C4 actually cares about per-viewport.
      name: 'desktop',
      testDir: './e2e',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: 'http://127.0.0.1:5173' },
    },
    {
      name: 'mobile',
      testDir: './e2e',
      use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:5173' },
      testMatch: /responsive\.spec\.js/,
    },
  ],
})
