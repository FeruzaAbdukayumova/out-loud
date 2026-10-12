import { defineConfig, devices } from '@playwright/test'

const PORT = 4175
const API_PORT = 8788

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    // the real sync server, with a throwaway in-memory Postgres
    {
      command: 'npx tsx src/index.ts',
      cwd: 'server',
      env: { DATABASE_URL: 'memory', PORT: String(API_PORT), ALLOWED_ORIGINS: `http://localhost:${PORT}` },
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    // the production build, so the service worker and offline mode are tested too
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
