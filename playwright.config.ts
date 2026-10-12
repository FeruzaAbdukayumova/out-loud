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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: 'on-device.spec.ts' },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: 'on-device.spec.ts' },
    // a real microphone (playing a recording) and the real speech model
    {
      name: 'on-device',
      testMatch: 'on-device.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${import.meta.dirname}/e2e/audio/morning.wav`,
          ],
        },
      },
    },
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
