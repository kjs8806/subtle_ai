import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    allowedHosts: ['.app.github.dev'],
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})