import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { assertNoDuplicateEnvKeys } from '@obiter/config/env-keys'
import { applyDevServerApiOrigin } from './dev-api-origin.mjs'
import { readPort, SHARED_WEB_PORT } from './lane-target.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

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
  for (const envFile of [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ]) {
    assertNoDuplicateEnvKeys(join(repoRoot, envFile))
  }

  const fileEnv = loadEnv(mode, repoRoot, '')
  if (isBuild) delete process.env.VITE_USER_NODE_ENV
  const read = (key: string) => process.env[key] ?? fileEnv[key]

  if (isBuild) {
    return {
      envDir: false,
      resolve: {
        tsconfigPaths: true,
      },
      plugins: [tanstackStart(), tailwindcss(), react()],
    }
  }

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
      port: configuredWebPort,
      strictPort: true,
      proxy: {},
    },
    environments: { ssr: {} },
    plugins: [
      devApiOriginPlugin({ fileEnv }),
      tanstackStart(),
      tailwindcss(),
      react(),
    ],
  }
})
