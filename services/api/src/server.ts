import { serve } from '@hono/node-server'
import { createApiApp } from './app'
import { createPool } from './database'
import { readApiEnv } from './env'
import { configureRedactionDetector } from './redaction-detection'

const env = readApiEnv()
configureRedactionDetector({
  model: env.rampartModel,
  revision: env.rampartRevision,
  cacheDir: env.rampartCacheDir,
  minScore: env.rampartMinScore,
  chunkTokens: env.rampartChunkTokens,
})
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

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${env.port} is already in use — is another dev:api instance running?`,
    )
    process.exit(1)
  }

  throw error
})
