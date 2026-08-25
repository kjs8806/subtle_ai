import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    allowedHosts: ['.app.github.dev'],
    proxy: {
      // Overridable so the #43 e2e suite (playwright.e2e.config.js) can point
      // its dev client at a backend port other than the browser smoke suite's
      // hardcoded 8787 (playwright.config.js) - both suites' backends default
      // to the same port (server/config/env.js), and now that both run
      // sequentially in one CI job (.github/workflows/ci.yml), a shared port
      // risks the second suite's server racing the first's not-yet-released
      // port and failing to bind, leaving every /api request unanswered.
      '/api': process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787',
    },
  },
})