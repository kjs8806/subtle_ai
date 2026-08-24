import { defineConfig, devices } from '@playwright/test'

// #43 Accessibility & Cross-Browser QA Gate
//
// GMAIL_PROVIDER defaults to 'mock' (see server/config/env.js), so browser CI
// never talks to real Google/Gmail and never needs production OAuth secrets.
// The current mock provider binds sign-in to one fixed backend account, so the
// suite must remain serial until engineering provides isolated test identities.
// Serial execution keeps the existing mutating onboarding flow deterministic
// while allowing the same core journey to run against multiple browser engines.
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
