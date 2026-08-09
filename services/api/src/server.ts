import { serve } from '@hono/node-server'
import { createApiApp } from './app'
import { createPool } from './database'
import { readApiEnv } from './env'
import { warmRedactionDetector } from './redaction-detection'

const env = readApiEnv()
const pool = createPool(env)
const app = createApiApp(env, pool)

const server = serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    console.info(`Obiter API listening on http://localhost:${info.port}`)
  },
)

// Deliberately not awaited: the first run on a cold cache downloads ~15 MB from
// Hugging Face, and health checks and every non-redaction route should be
// answering while that happens.
void warmRedactionDetector().then(
  () => {
    console.info('Rampart detection model ready', {
      model: env.rampartModel,
      revision: env.rampartRevision,
      cacheDir: env.rampartCacheDir,
    })
  },
  (error: unknown) => {
    console.error(
      'Rampart detection model failed to load — redaction runs will be limited to heuristics until it does. ' +
        `Run "pnpm prefetch:rampart" to fetch it, or set OBITER_RAMPART_CACHE_DIR to a directory that already has it.`,
      {
        model: env.rampartModel,
        revision: env.rampartRevision,
        cacheDir: env.rampartCacheDir,
        reason: error instanceof Error ? error.message : String(error),
      },
    )
  },
)

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${env.port} is already in use — is another dev:api instance running?`,
    )
    process.exit(1)
  }

  throw error
})
