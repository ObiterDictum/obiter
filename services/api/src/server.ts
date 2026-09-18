import { serve } from '@hono/node-server'
import { exitOnStartupFailure, installGracefulShutdown } from './lifecycle'
import { createApiRuntime } from './runtime'

/**
 * Node entry point and the documented rollback path. It serves the same
 * application as `server-bun.ts` through `@hono/node-server`; switching back is
 * redeploying the image whose entry point is this file, with no data or schema
 * change involved.
 */
async function main() {
  const { env, pool, app } = await createApiRuntime('node')

  const server = serve(
    {
      fetch: app.fetch,
      port: env.port,
    },
    (info) => {
      console.info(
        `Obiter API (Node ${process.version}) listening on http://localhost:${info.port}`,
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

  installGracefulShutdown({
    stopAccepting: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        // Keep-alive sockets are idle, not in flight; close() alone would wait
        // out their timeout before its callback runs. Only the HTTP/1 server
        // type exposes this, and this adapter only ever serves HTTP/1.
        if ('closeIdleConnections' in server) server.closeIdleConnections()
      }),
    closeResources: () => pool.end(),
    pendingCount: () =>
      new Promise<number | null>((resolve) =>
        server.getConnections((error, count) => resolve(error ? null : count)),
      ),
  })
}

void main().catch(exitOnStartupFailure)
