import { defineConfig, devices } from '@playwright/test'
import { assertLaneTargets, resolveLaneTargets } from './lane-target.mjs'

const targets = resolveLaneTargets()
const reuseExistingServer = !process.env.CI
assertLaneTargets(targets, { reuseExistingServer })

const { apiOrigin, webOrigin, webPort } = targets
const rendererPort = Number(process.env.OBITER_E2E_RENDERER_PORT ?? 8892)
const rendererOrigin = `http://127.0.0.1:${rendererPort}`

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
      command: 'bun e2e/renderer-server.ts',
      url: `${rendererOrigin}/ready`,
      reuseExistingServer,
      timeout: 30_000,
      env: {
        OBITER_E2E_RENDERER_PORT: String(rendererPort),
      },
    },
    {
      command: 'bun run --filter @obiter/web dev',
      url: webOrigin,
      reuseExistingServer,
      timeout: 60_000,
      env: {
        OBITER_API_ORIGIN: apiOrigin,
        OBITER_WEB_PORT: String(webPort),
      },
    },
  ],
})
