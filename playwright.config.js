import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
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
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      grep: /@mobile|@critical/,
    },
  ],
})
