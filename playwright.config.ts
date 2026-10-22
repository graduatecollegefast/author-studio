import { defineConfig, devices } from '@playwright/test'

// Requires a running Supabase (local stack or disposable project). See docs/TESTING.md.
const env = {
  VITE_SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '',
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '',
  FUNCTIONS_PORT: '8899',
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: 'npx tsx scripts/dev-functions.ts', port: 8899, env, reuseExistingServer: false },
    { command: 'npx vite --port 5199 --strictPort', port: 5199, env, reuseExistingServer: false },
  ],
})
