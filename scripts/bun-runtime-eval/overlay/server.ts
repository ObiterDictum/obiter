import { serve } from '@hono/node-server'
import { createApiRuntime } from './runtime'

async function main() {
  const { env, pool, app } = await createApiRuntime()

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

  // Experimental addition for the runtime comparison only (not shipping code):
  // the current server installs no signal handler, so a SIGTERM aborts
  // in-flight requests and never drains the pool. Both adapters get the same
  // handler so shutdown is compared like for like.
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.info(`Obiter API received ${signal}; draining.`)
    const forced = setTimeout(() => {
      console.error('Obiter API drain timed out; exiting.')
      process.exit(1)
    }, 10_000)
    forced.unref()
    server.close(() => {
      void pool.end().then(() => {
        console.info('Obiter API drained and database pool closed.')
        process.exit(0)
      })
    })
    // Keep-alive sockets are idle, not in flight; close() alone would wait out
    // their timeout before the callback runs.
    server.closeIdleConnections()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

void main()
