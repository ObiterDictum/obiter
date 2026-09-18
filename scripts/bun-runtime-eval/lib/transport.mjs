/*
 * HTTP transport helpers shared by the measured journeys.
 *
 * These are the *load generator*, deliberately kept outside the measured
 * process: a server's latency numbers describe the harness if the harness is
 * the bottleneck, so its CPU is recorded alongside the server's.
 */
import { Agent, request as httpRequest } from 'node:http'
import { performance } from 'node:perf_hooks'

export const bearer = (token) =>
  token ? { Authorization: `Bearer ${token}` } : {}

export const json = (body, token) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...bearer(token) },
  body: JSON.stringify(body),
})

/** Time a fetch including the full body read, so a streamed body is counted. */
export async function timedFetch(url, init) {
  const started = performance.now()
  const response = await fetch(url, init)
  const body = await response.arrayBuffer()
  return {
    ms: performance.now() - started,
    status: response.status,
    bytes: body.byteLength,
  }
}

/** Reuse one keep-alive connection for N requests and time each one. */
export async function keepAliveSequence({ port, path, headers, count }) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  const times = []
  let failures = 0
  for (let i = 0; i < count; i += 1) {
    const started = performance.now()
    const ok = await new Promise((done) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, path, headers, agent },
        (response) => {
          response.resume()
          response.on('end', () => done(response.statusCode === 200))
        },
      )
      request.on('error', () => done(false))
      request.end()
    })
    times.push(performance.now() - started)
    if (!ok) failures += 1
  }
  agent.destroy()
  return { times, failures }
}

/** Download with a deliberately slow reader, to exercise backpressure. */
export function slowDownload(url, { token, readDelayMs }) {
  return new Promise((done) => {
    const parsed = new URL(url)
    const started = performance.now()
    const request = httpRequest(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        headers: bearer(token),
      },
      (response) => {
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          response.pause()
          setTimeout(() => response.resume(), readDelayMs)
        })
        response.on('end', () =>
          done({
            ms: performance.now() - started,
            status: response.statusCode,
            bytes,
          }),
        )
      },
    )
    request.on('error', (error) =>
      done({
        ms: performance.now() - started,
        status: 0,
        bytes: 0,
        note: error.message,
      }),
    )
    request.end()
  })
}
