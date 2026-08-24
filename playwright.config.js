// Browser smoke suite configuration for QA regression coverage.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // fullyParallel:false only serializes tests within one project/file; it does
  // not stop Playwright from running the desktop-chromium and mobile-chromium
  // projects concurrently in separate workers. Both share one backend
  // (port 8787, one in-memory PERSISTENCE_PROVIDER store) and one frontend
  // dev server (port 4173) - two projects' tests genuinely racing those
  // shared servers caused real, reproducible cross-test interference
  // (a correction save from one test observed as unapplied by another test
  // running at the same moment). Pinning workers:1 makes every test in the
  // suite run strictly one at a time, matching what this config already
  // assumed but never enforced.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
  ],
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
      // @mobile-tagged tests exercise mobile-only layout (the slide-out menu,
      // viewport-dependent affordances) and have no meaningful desktop
      // equivalent - they belong solely to the mobile project below.
      // @critical and untagged tests still run here.
      grepInvert: /@mobile/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      // Only @mobile (mobile-specific) and @critical (must pass on both
      // viewports) tests run here - untagged tests are covered once by
      // desktop and don't need a second, viewport-identical run.
      grep: /@mobile|@critical/,
    },
  ],
})
