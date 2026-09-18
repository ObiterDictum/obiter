/* Transport gates: connections, protocol, timeouts, graceful shutdown. */
import { Agent, request as httpRequest } from 'node:http'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  WORKTREE,
  bearer,
  group,
  measureHalfHeader,
  measureIdleKeepAlive,
  rawRequest,
  record,
} from './harness.mjs'

export async function checkConnections({ origin, port, ids }) {
  // ---- keep-alive and concurrency
  group('connections')

  const agent = new Agent({ keepAlive: true, maxSockets: 2 })
  const keepAliveStatuses = await Promise.all(
    Array.from(
      { length: 12 },
      () =>
        new Promise((done) => {
          const request = httpRequest(
            {
              host: '127.0.0.1',
              port,
              path: '/api/matters',
              headers: bearer(ids.sessionToken),
              agent,
            },
            (response) => {
              response.resume()
              response.on('end', () => done(response.statusCode))
            },
          )
          request.on('error', () => done(0))
          request.end()
        }),
    ),
  )
  const connectionReuse = agent.totalSocketCount
  agent.destroy()
  record(
    'keep-alive reuses sockets across 12 requests',
    keepAliveStatuses.every((status) => status === 200) && connectionReuse <= 2,
    `statuses=${[...new Set(keepAliveStatuses)].join(',')} sockets=${connectionReuse}`,
  )

  const concurrent = await Promise.all(
    Array.from({ length: 24 }, () =>
      fetch(`${origin}/api/matters`, {
        headers: bearer(ids.sessionToken),
      }).then((response) => response.status),
    ),
  )
  record(
    '24 concurrent authenticated requests all succeed',
    concurrent.every((status) => status === 200),
    `statuses=${[...new Set(concurrent)].join(',')}`,
  )

  const pipelined = await rawRequest({
    port,
    path: '/api/matters',
    headers: { ...bearer(ids.sessionToken), Connection: 'keep-alive' },
  })
  record(
    'response advertises keep-alive on HTTP/1.1',
    pipelined.status === 200 &&
      (pipelined.headers.connection === undefined ||
        pipelined.headers.connection === 'keep-alive'),
    `connection=${pipelined.headers.connection ?? 'absent (HTTP/1.1 default)'}`,
  )
}

export async function checkProtocol({ port, ids }) {
  // ---- expected headers, statuses, errors
  group('protocol')

  const health = await rawRequest({ port, path: '/api/health' })
  record(
    'health is 200 JSON with the provenance this checkout expects',
    health.status === 200 &&
      health.headers['content-type']?.startsWith('application/json') &&
      JSON.parse(health.body.toString('utf8')).provenance?.checkoutRoot ===
        WORKTREE,
    `status=${health.status} content-type=${health.headers['content-type']}`,
  )

  const notFound = await rawRequest({
    port,
    path: '/api/definitely-not-a-route',
  })
  record(
    'unknown route is 404, not 500',
    notFound.status === 404,
    `status=${notFound.status}`,
  )

  const badJson = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': 'application/json',
    },
    body: Buffer.from('{"filename": '),
  })
  record(
    'malformed JSON is 4xx, not 500',
    badJson.status >= 400 && badJson.status < 500,
    `status=${badJson.status}`,
  )

  const head = await rawRequest({ port, path: '/api/health', method: 'HEAD' })
  record(
    'HEAD /api/health has no body and a matching status',
    head.status === 200 && head.body.byteLength === 0,
    `status=${head.status} bytes=${head.body.byteLength}`,
  )

  const errorShape = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}`,
    headers: bearer('not-a-real-token'),
  })
  const errorBody = JSON.parse(errorShape.body.toString('utf8') || '{}')
  record(
    'error responses carry the contract error envelope',
    errorShape.status === 401 && typeof errorBody?.error?.code === 'string',
    `status=${errorShape.status} code=${errorBody?.error?.code ?? 'none'}`,
  )
}

export async function checkTimeouts({ port, ids }) {
  // ---- timeout behaviour
  group('timeouts')

  // Node's http server has headersTimeout/requestTimeout/keepAliveTimeout;
  // Bun.serve has a single idleTimeout. Both are observable, so they are
  // measured rather than read off the documentation. The 40 s cap here is
  // deliberately shorter than Node's defaults; `timeouts.mjs` repeats these
  // probes with a 100 s cap.
  const idle = await measureIdleKeepAlive({
    port,
    token: ids.sessionToken,
    capMs: 40_000,
  })
  record(
    'idle keep-alive socket is closed by the server',
    idle.closedMs !== null,
    `closed after ${idle.closedMs === null ? '>40s (cap)' : `${Math.round(idle.closedMs)}ms`}`,
    { observed: idle },
  )

  const halfHeader = await measureHalfHeader({ port, capMs: 40_000 })
  record(
    'a half-sent request header is closed by the server within 40s',
    halfHeader.closedMs !== null,
    `closed after ${halfHeader.closedMs === null ? '>40s (cap)' : `${Math.round(halfHeader.closedMs)}ms`}`,
    { observed: halfHeader },
  )
}

/**
 * SIGTERM while a request is in flight: the in-flight response must complete,
 * the process must exit 0, and the pool must be closed deliberately rather than
 * torn down with the process. Operates on the live server object, so it runs
 * last and replaces the ordinary stop.
 */
export async function runShutdownGate({ server, port, ids, state, log }) {
  const documentId = state.lastUploadedDocumentId
  group('graceful shutdown')
  let inFlight = null
  const slow = new Promise((done) => {
    const started = performance.now()
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: `/api/documents/${documentId}/download`,
        headers: bearer(ids.sessionToken),
      },
      (response) => {
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          response.pause()
          // Slow enough that the response is still open when SIGTERM lands.
          setTimeout(() => response.resume(), 120)
        })
        response.on('end', () =>
          done({
            status: response.statusCode,
            bytes,
            ms: performance.now() - started,
          }),
        )
      },
    )
    request.on('error', (error) =>
      done({
        status: 0,
        bytes: 0,
        error: error.message,
        ms: performance.now() - started,
      }),
    )
    request.end()
    inFlight = request
  })

  await sleep(300)
  const signalledAt = performance.now()
  try {
    process.kill(-server.child.pid, 'SIGTERM')
  } catch {
    server.child.kill('SIGTERM')
  }
  const result = await slow
  const drained = await new Promise((done) => {
    const deadline = Date.now() + 12_000
    const tick = () => {
      if (server.child.exitCode !== null)
        return done({ code: server.child.exitCode })
      if (Date.now() > deadline) return done({ code: null })
      setTimeout(tick, 50)
    }
    tick()
  })
  server.stopped = true
  record(
    'in-flight request completes through SIGTERM',
    result.status === 200 && result.bytes > 0,
    `status=${result.status} bytes=${result.bytes} closed ${Math.round(performance.now() - signalledAt)}ms after signal`,
  )
  record(
    'process exits 0 after draining',
    drained.code === 0,
    `exitCode=${drained.code}`,
  )
  record(
    'database pool is closed deliberately on shutdown',
    log.join('').includes('drained and database pool closed'),
    log.join('').includes('drained and database pool closed')
      ? 'shutdown log line present'
      : 'shutdown log line absent',
  )
  const afterExit = await fetch(`http://127.0.0.1:${port}/api/health`)
    .then((response) => response.status)
    .catch(() => 'connection_refused')
  record(
    'the port is released (no lingering listener)',
    afterExit === 'connection_refused',
    `health after exit=${afterExit}`,
  )
  void inFlight
}
