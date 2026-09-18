import { createApiRuntime } from './runtime'

/**
 * Bun candidate adapter for the runtime comparison.
 *
 * Deliberately not `@hono/node-server` under Bun: the candidate is native
 * `Bun.serve`, so the only thing that differs from the Node baseline is the
 * socket layer and the runtime. The application, routes, middleware, contracts
 * and database access come from the same `createApiRuntime()`.
 *
 * The options below are set explicitly so the server does not silently run
 * with Bun's defaults where Node's differ. See the report's adapter-default
 * table for the Node equivalents.
 */
interface BunServer {
  port: number
  stop(closeActiveRequests?: boolean): Promise<void>
}

declare const Bun: {
  serve(options: {
    port: number
    hostname: string
    fetch: (request: Request) => Response | Promise<Response>
    error?: (error: Error) => Response
    idleTimeout?: number
    maxRequestBodySize?: number
  }): BunServer
}

async function main() {
  const { env, pool, app } = await createApiRuntime()

  const server = Bun.serve({
    port: env.port,
    // Bun.serve defaults to 0.0.0.0 (IPv4 any); Node's `listen(port)` binds
    // dual-stack. Stated here rather than left implicit — the report records
    // the binding each runtime actually makes.
    hostname: '0.0.0.0',
    fetch: app.fetch,
    // Backstop only. The application's own body-limit middleware stays
    // authoritative (25 MiB uploads, JSON cap from env); this is high enough
    // that the app produces its own 413, and low enough that an unbounded
    // body cannot be buffered by the transport.
    maxRequestBodySize: 64 * 1024 * 1024,
    // Bun has one knob where Node has keepAliveTimeout/headersTimeout/
    // requestTimeout. It is the idle-connection timeout, not a request
    // deadline.
    idleTimeout: 30,
    error(error) {
      console.error('Bun.serve handler error', {
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        {
          error: {
            code: 'storage_unavailable',
            message: 'The API could not complete the request.',
            requestId: 'req_bun_serve_error',
          },
        },
        { status: 500 },
      )
    },
  })

  console.info(`Obiter API listening on http://localhost:${server.port}`)

  // Same shutdown contract as the Node adapter: stop accepting, drain in-flight
  // requests, close the pool, and exit non-zero if the drain does not finish.
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
    void server.stop(false).then(async () => {
      await pool.end()
      console.info('Obiter API drained and database pool closed.')
      process.exit(0)
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

void main().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : null
  if (code === 'EADDRINUSE') {
    console.error('Port is already in use — is another API instance running?')
    process.exit(1)
  }
  throw error
})
