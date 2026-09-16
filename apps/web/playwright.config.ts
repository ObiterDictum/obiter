/*
 * Lane targeting for the Playwright suite.
 *
 * Port resolution, the shared-port refusal and checkout verification live in
 * lane-target.mjs so the config, the global setup and the node:test suite all
 * use the same rules. In short: ports come from the process environment first
 * and this worktree's .env second, a local run refuses the shared 3000/8787
 * ports, and e2e/global-setup.ts proves the servers serve this checkout before
 * any browser starts.
 */
import { defineConfig, devices } from '@playwright/test'
import { assertLaneTargets, resolveLaneTargets } from './lane-target.mjs'

const targets = resolveLaneTargets()
const reuseExistingServer = !process.env.CI
assertLaneTargets(targets, { reuseExistingServer })

const { apiOrigin, apiPort, webOrigin, webPort } = targets

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
      reuseExistingServer,
      timeout: 60_000,
      env: {
        // Override a stale .env DATABASE_URL (postgres:saskiA123) so the
        // API connects to the local docker postgres the way ci-local.sh
        // expects. Same for Meilisearch — pin to the local docker on
        // 7700/meili to avoid the Tailscale host in .env.
        DATABASE_URL: 'postgresql://obiter:obiter@127.0.0.1:5432/obiter',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
        MEILISEARCH_SEARCH_API_KEY: 'obiter-local-dev-key',
        MEILISEARCH_ADMIN_API_KEY: 'obiter-local-dev-key',
        MEILI_MASTER_KEY: 'obiter-local-dev-key',
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
      reuseExistingServer,
      timeout: 60_000,
      env: {
        OBITER_API_ORIGIN: apiOrigin,
        // Pinned from the resolved targets so a start-here run agrees with the
        // baseURL Playwright uses, whether the port came from the environment
        // or from this worktree's .env.
        OBITER_WEB_PORT: String(webPort),
      },
    },
  ],
})
