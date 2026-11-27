import { defineConfig, devices } from '@playwright/test'
import { readPort } from './lane-target.mjs'

const webPort = readPort(process.env.OBITER_WEB_PORT, 'OBITER_WEB_PORT', 13030)
const webOrigin = `http://localhost:${webPort}`
const apiPort = readPort(
  process.env.OBITER_TEST_API_PORT,
  'OBITER_TEST_API_PORT',
  13031,
)
const apiOrigin = `http://127.0.0.1:${apiPort}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: webOrigin },
  projects: [
    {
      name: 'judgment-notices',
      testMatch: 'judgment-licence-notices.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'anchored-sign-in',
      testMatch: 'sign-in-return.spec.ts',
      grep: /@anchored-sign-in/,
      metadata: { syntheticSignIn: true },
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `bun e2e/sign-in-api.fixture.ts ${apiPort}`,
      url: `${apiOrigin}/ready`,
    },
    {
      command: 'bun run dev',
      url: `${webOrigin}/sign-in`,
      env: {
        OBITER_API_ORIGIN: apiOrigin,
        OBITER_WEB_PORT: String(webPort),
      },
    },
  ],
})
