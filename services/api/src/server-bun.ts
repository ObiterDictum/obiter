import { randomUUID } from 'node:crypto'
import { exitOnStartupFailure, installGracefulShutdown } from './lifecycle'
import { closeDocumentModelWorkers } from './document-model-pool'
import { createApiRuntime } from './runtime'

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
  // SAFETY: the cast only adds an optional Bun property for runtime detection; when it is
  const runtime = (globalThis as { Bun?: BunGlobal }).Bun
  if (!runtime) {
    throw new Error(
      'server-bun.ts needs the Bun runtime: run it as "bun services/api/src/server-bun.ts". ' +
        'Use server.ts for the Node runtime.',
    )
  }
  return runtime
}

function createRequestId() {
  return `req_${randomUUID()}`
}

async function main() {
  const { env, pools, app, stopDetectionWorker } = await createApiRuntime('bun')

  const server = bun.serve({
    port: env.port,
    hostname: '0.0.0.0',
    fetch: app.fetch,
    maxRequestBodySize: 64 * 1024 * 1024,
    idleTimeout: 30,
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

  installGracefulShutdown(
    {
      stopAccepting: async () => {
        await Promise.all([server.stop(false), stopDetectionWorker()])
      },
      closeResources: async () => {
        await Promise.all([pools.close(), closeDocumentModelWorkers()])
      },
      pendingCount: () => server.pendingRequests,
    },
    { deadlineMs: 120_000 },
  )
}

void main().catch(exitOnStartupFailure)
