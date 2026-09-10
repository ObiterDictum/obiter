import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { parsePort } from './serve.mjs'

// The API reads the repo-root .env through its own loader (services/api/src/env.ts
// loadLocalDotEnv), which walks up from cwd. Vite has no such loader and reads
// process.env, so without this a lane's .env configures its API and silently
// fails to configure its web server. Load the same file, from the same place.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig(({ mode }) => {
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
