import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { assertNoDuplicateEnvKeys } from '@obiter/config/env-keys'
import { applyDevServerApiOrigin } from './dev-api-origin.mjs'
import { readPort, SHARED_WEB_PORT } from './lane-target.mjs'

// The API and the ingestor read the repo-root .env through @obiter/config
// (resolveLocalEnvFile), which walks up from cwd and stops at the worktree
// root. Vite has no such walk and reads the same directory, so without this a
// lane's .env configures its API and silently fails to configure its web
// server. Load the same file, from the same place.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The dev server's API origin is resolved in `configResolved`, not while this
 * config function runs. `configResolved` is the first point at which
 * `config.server.port` is the port the server will actually bind: Vite merges
 * CLI options such as `--port` after the config function returns. Resolving
 * earlier would let `vite dev --port 3098` bind a non-shared port while
 * eligibility for the shared default was still decided from the configured 3000.
 *
 * The plugin mutates the resolved config's proxy and SSR define through the
 * one resolver so the browser proxy and the in-process SSR handler cannot
 * disagree.
 */
function devApiOriginPlugin({
  processEnv = process.env,
  fileEnv,
}: {
  processEnv?: Record<string, string | undefined>
  fileEnv: Record<string, string>
}): Plugin {
  return {
    name: 'obiter:dev-api-origin',
    configResolved(config: ResolvedConfig) {
      applyDevServerApiOrigin(config, { processEnv, fileEnv })
    },
  }
}

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

  if (isBuild) {
    return {
      // See the note above: a build reads no env file, so a worktree .env cannot
      // choose the build mode.
      envDir: false,
      resolve: {
        tsconfigPaths: true,
      },
      plugins: [tanstackStart(), tailwindcss(), react()],
    }
  }

  // Strict parse: an absent OBITER_WEB_PORT keeps the shared dev default, but a
  // supplied value that is not a decimal 1..65535 is refused before the server
  // starts instead of silently becoming the shared port 3000. Shared-default
  // eligibility is then checked against the effective port in configResolved.
  const configuredWebPort = readPort(
    read('OBITER_WEB_PORT'),
    'OBITER_WEB_PORT',
    SHARED_WEB_PORT,
  )

  return {
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      // Lane worktrees run their own web and API on distinct ports so they never
      // collide with the shared dev servers. Both must come from the lane's .env:
      // a lane that serves its own UI while proxying to the shared API renders a
      // page that looks correct and is measuring the wrong branch.
      port: configuredWebPort,
      // Fail loudly when the port is taken. Vite's default is to move silently
      // to the next free port, which in a multi-lane setup means a misconfigured
      // lane binds a neighbouring lane's port and verifies against the wrong
      // branch while appearing to work. Observed: a lane web server configured
      // for 3000 found it occupied and bound 3001, which belongs to lane-search.
      // A port collision is a configuration error and should stop the server.
      strictPort: true,
      // The target is filled in by `configResolved`, once CLI options such as
      // `--port` have been merged and the effective port is known. The object is
      // shared with `preview.proxy`, so the plugin mutates it in place.
      proxy: {},
    },
    // The define is scoped to the ssr environment so the browser bundle never
    // receives the origin. It is dev-only: a build reads no worktree .env and
    // must not bake one in; the production server reads its own environment at
    // runtime.
    environments: { ssr: {} },
    plugins: [
      devApiOriginPlugin({ fileEnv }),
      tanstackStart(),
      tailwindcss(),
      react(),
    ],
  }
})
