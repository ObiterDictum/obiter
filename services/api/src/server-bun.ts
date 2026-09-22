import { randomUUID } from 'node:crypto'
import { exitOnStartupFailure, installGracefulShutdown } from './lifecycle'
import { createApiRuntime } from './runtime'

/**
 * Native `Bun.serve` entry point. Deliberately not `@hono/node-server` running
 * under Bun: the socket layer and the runtime are the only things that differ
 * from `server.ts`, because the application comes from the shared
 * `createApiRuntime()`.
 *
 * Bun's globals are declared here rather than by installing `bun-types`, which
 * would add Bun globals to every `tsc` run in the workspace including the Node
 * build. The surface below is exactly what this file uses, and the pinned Bun
 * runtime is what checks it — the Bun-runtime CI job boots this file for real.
 */
interface BunServeOptions {
  port: number
  hostname: string
  fetch: (request: Request) => Response | Promise<Response>
  error?: (error: Error) => Response
  idleTimeout?: number
  maxRequestBodySize?: number
  development?: boolean
}

interface BunServerHandle {
  readonly port: number
  readonly pendingRequests: number
  stop(closeActiveConnections?: boolean): Promise<void>
}

interface BunGlobal {
  readonly version: string
  serve(options: BunServeOptions): BunServerHandle
}

const bun = requireBun()

function requireBun(): BunGlobal {
  const runtime = (globalThis as { Bun?: BunGlobal }).Bun
  if (!runtime) {
    throw new Error(
      'server-bun.ts needs the Bun runtime: run it as "bun services/api/src/server-bun.ts". ' +
        'Use server.ts for the Node runtime.',
    )
  }
  return runtime
}

/**
 * The application's request-id shape (`app.ts`). Bun's error hook runs outside
 * Hono's context, so it mints its own id in the same format rather than
 * emitting one shared placeholder for every failure. No request content is
 * logged.
 */
function createRequestId() {
  return `req_${randomUUID()}`
}

async function main() {
  const { env, pools, app } = await createApiRuntime('bun')

  const server = bun.serve({
    port: env.port,
    // Bun.serve defaults to 0.0.0.0 (IPv4 any); Node's listen(port) binds
    // dual-stack. Stated explicitly so the binding is a decision, not a default.
    hostname: '0.0.0.0',
    fetch: app.fetch,
    // Backstop only. The application's own middleware stays authoritative (the
    // 48 KiB JSON cap and 25 MiB upload cap, so a 413 carries the contract's
    // error shape), and 64 MiB is low enough that an unbounded body cannot be
    // buffered by the transport.
    maxRequestBodySize: 64 * 1024 * 1024,
    // One knob where Node has keepAliveTimeout/headersTimeout/requestTimeout.
    // Bun applies it to an idle connection, a handler that has produced no
    // bytes and a response stream that has gone quiet alike; it is not a
    // request deadline. See docs/specs/deployment.md for the proxy prerequisites.
    idleTimeout: 30,
    // Never render Bun's development error page, which prints source paths and
    // a stack trace. It must not depend on NODE_ENV being set correctly.
    development: false,
    error(error) {
      const requestId = createRequestId()
      console.error('Bun.serve handler error', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        {
          error: {
            code: 'storage_unavailable',
            message: 'The API could not complete the request.',
            requestId,
          },
        },
        { status: 500 },
      )
    },
  })

  console.info(
    `Obiter API (Bun ${bun.version}) listening on http://localhost:${server.port}`,
  )

  installGracefulShutdown({
    // stop(false) stops accepting and settles once in-flight requests finish;
    // stop(true) would kill them, which is what the deadline exists for.
    stopAccepting: () => server.stop(false),
    closeResources: () => pools.close(),
    pendingCount: () => server.pendingRequests,
  })
}

void main().catch(exitOnStartupFailure)
