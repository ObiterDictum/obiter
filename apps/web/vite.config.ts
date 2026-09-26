import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { assertNoDuplicateEnvKeys } from '@obiter/config/env-keys'
import { resolveDevApiOrigin } from './dev-api-origin.mjs'
import { parsePort } from './serve.mjs'

// The API and the ingestor read the repo-root .env through @obiter/config
// (resolveLocalEnvFile), which walks up from cwd and stops at the worktree
// root. Vite has no such walk and reads the same directory, so without this a
// lane's .env configures its API and silently fails to configure its web
// server. Load the same file, from the same place.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build'
  // React's production runtime is selected from NODE_ENV, not from `mode`, and
  // Vite checks that variable before anything in this config runs. An exported
  // NODE_ENV=development (a shell, a CI job, or a tool wrapping the build) would
  // therefore compile the development runtime into the bundle; refuse before
  // any output is written rather than producing a misleading artifact. The
  // Docker build stage sets no NODE_ENV, and neither does `bun run build`.
  if (
    isBuild &&
    process.env.NODE_ENV &&
    process.env.NODE_ENV !== 'production'
  ) {
    throw new Error(
      `Refusing to build: NODE_ENV=${process.env.NODE_ENV}. A production build must compile ` +
        'React\'s production runtime; unset NODE_ENV or set it to "production".',
    )
  }
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

  // A production build must not take its mode from the worktree's .env. Vite
  // honours a `NODE_ENV` key in a .env file through VITE_USER_NODE_ENV and
  // compiles React's development build into the bundle; the Docker build
  // copies no .env and therefore does not. Reading no env file during a build
  // and dropping the key Vite already harvested makes the two agree. Runtime
  // configuration is still read through `read()` below, and the web app reads
  // no VITE_ variables at build time.
  const fileEnv = loadEnv(mode, repoRoot, '')
  if (isBuild) delete process.env.VITE_USER_NODE_ENV
  const read = (key: string) => process.env[key] ?? fileEnv[key]

  // The dev server owns both halves of the API path: the proxy that carries
  // browser requests and the in-process SSR handler that calls apiUrl(). Resolve
  // one origin through the same process-env-then-.env precedence the rest of the
  // config uses, give it to the proxy, and replace the SSR modules' process.env
  // lookup with it at transform time. Replacing rather than assigning
  // process.env keeps the resolver honest across a config restart: a value it
  // wrote itself would otherwise win over an edited .env on the next evaluation.
  // The define is scoped to the ssr environment so the browser bundle never
  // receives it, and it is dev-only: a build reads no worktree .env and must not
  // bake one in; the production server reads its own environment at runtime.
  let devServer
  let ssrDefine
  if (!isBuild) {
    const webPort = parsePort(read('OBITER_WEB_PORT'))
    const apiOrigin = resolveDevApiOrigin({
      processEnv: process.env,
      fileEnv,
      webPort,
    })
    devServer = {
      // Lane worktrees run their own web and API on distinct ports so they never
      // collide with the shared dev servers. Both must come from the lane's .env:
      // a lane that serves its own UI while proxying to the shared API renders a
      // page that looks correct and is measuring the wrong branch.
      port: webPort,
      // Fail loudly when the port is taken. Vite's default is to move silently
      // to the next free port, which in a multi-lane setup means a misconfigured
      // lane binds a neighbouring lane's port and verifies against the wrong
      // branch while appearing to work. Observed: a lane web server configured
      // for 3000 found it occupied and bound 3001, which belongs to lane-search.
      // A port collision is a configuration error and should stop the server.
      strictPort: true,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: false,
        },
      },
    }
    ssrDefine = {
      'process.env.OBITER_API_ORIGIN': JSON.stringify(apiOrigin),
    }
  }

  return {
    // See the note above: a build reads no env file, so a worktree .env cannot
    // choose the build mode.
    envDir: isBuild ? false : undefined,
    resolve: {
      tsconfigPaths: true,
    },
    server: devServer,
    environments: isBuild ? undefined : { ssr: { define: ssrDefine } },
    plugins: [tanstackStart(), tailwindcss(), react()],
  }
})
