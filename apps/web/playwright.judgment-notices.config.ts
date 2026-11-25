import { defineConfig, devices } from '@playwright/test'
import { readPort } from './lane-target.mjs'

const webPort = readPort(process.env.OBITER_WEB_PORT, 'OBITER_WEB_PORT', 13030)
const webOrigin = `http://localhost:${webPort}`

export default defineConfig({
  testDir: './e2e',
  testMatch: 'judgment-licence-notices.spec.ts',
  timeout: 60_000,
  use: {
    baseURL: webOrigin,
    ...devices['Desktop Safari'],
  },
  webServer: {
    command: 'bun run dev',
    url: `${webOrigin}/search`,
    env: {
      OBITER_API_ORIGIN: 'http://127.0.0.1:1',
      OBITER_WEB_PORT: String(webPort),
    },
  },
})
