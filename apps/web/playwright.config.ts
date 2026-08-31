import { defineConfig, devices } from '@playwright/test'

const apiPort = Number(process.env.PORT ?? 8787)
const webPort = 3000
const apiOrigin = `http://127.0.0.1:${apiPort}`
const webOrigin = `http://localhost:${webPort}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @obiter/api dev',
      url: `${apiOrigin}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        // Override a stale .env DATABASE_URL (postgres:saskiA123) so the
        // API connects to the local docker postgres the way ci-local.sh
        // expects. Same for Meilisearch — pin to the local docker on
        // 7700/meili to avoid the Tailscale host in .env.
        DATABASE_URL: 'postgresql://obiter:obiter@127.0.0.1:5432/obiter',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
        MEILISEARCH_SEARCH_API_KEY: 'search-benchmark-key',
        MEILISEARCH_ADMIN_API_KEY: 'search-benchmark-key',
        MEILI_MASTER_KEY: 'search-benchmark-key',
        BETTER_AUTH_URL: webOrigin,
        BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
        NODE_ENV: 'development',
        OBITER_WEB_ORIGIN: webOrigin,
        PORT: String(apiPort),
      },
    },
    {
      command: 'pnpm --filter @obiter/web dev',
      url: webOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        OBITER_API_ORIGIN: apiOrigin,
      },
    },
  ],
})
