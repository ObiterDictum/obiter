import { serve } from '@hono/node-server'
import { exitOnStartupFailure, installGracefulShutdown } from './lifecycle'
import { closeDocumentModelWorkers } from './document-model-pool'
import { createApiRuntime } from './runtime'

async function main() {
  const { env, pools, app } = await createApiRuntime('node')

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
        if ('closeIdleConnections' in server) server.closeIdleConnections()
      }),
    closeResources: async () => {
      await Promise.all([pools.close(), closeDocumentModelWorkers()])
    },
    pendingCount: () =>
      new Promise<number | null>((resolve) =>
        server.getConnections((error, count) => resolve(error ? null : count)),
      ),
  })
}

void main().catch(exitOnStartupFailure)
