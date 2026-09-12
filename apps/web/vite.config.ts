import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { assertNoDuplicateEnvKeys } from '@obiter/config/env-keys'
import { parsePort } from './serve.mjs'

// The API and the ingestor read the repo-root .env through @obiter/config
// (resolveLocalEnvFile), which walks up from cwd and stops at the worktree
// root. Vite has no such walk and reads the same directory, so without this a
// lane's .env configures its API and silently fails to configure its web
// server. Load the same file, from the same place.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig(({ mode }) => {
  // A key assigned twice in the same file is a configuration mistake: parseEnv
  // collapses it silently and a lane would run one value while reading two.
  // Refuse it here, with the same scan the services use, before loadEnv runs.
  for (const envFile of [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ]) {
    assertNoDuplicateEnvKeys(join(repoRoot, envFile))
  }

  const fileEnv = loadEnv(mode, repoRoot, '')
  const read = (key: string) => process.env[key] ?? fileEnv[key]

  return {
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      // Lane worktrees run their own web and API on distinct ports so they never
      // collide with the shared dev servers. Both must come from the lane's .env:
      // a lane that serves its own UI while proxying to the shared API renders a
      // page that looks correct and is measuring the wrong branch.
      port: parsePort(read('OBITER_WEB_PORT')),
      // Fail loudly when the port is taken. Vite's default is to move silently
      // to the next free port, which in a multi-lane setup means a misconfigured
      // lane binds a neighbouring lane's port and verifies against the wrong
      // branch while appearing to work. Observed: a lane web server configured
      // for 3000 found it occupied and bound 3001, which belongs to lane-search.
      // A port collision is a configuration error and should stop the server.
      strictPort: true,
      proxy: {
        '/api': {
          target: read('OBITER_API_ORIGIN') ?? 'http://localhost:8787',
          changeOrigin: false,
        },
      },
    },
    plugins: [tanstackStart(), tailwindcss(), react()],
  }
})
