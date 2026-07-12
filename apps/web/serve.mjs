/*
 * Production server bootstrap for @obiter/web (TanStack Start SSR).
 *
 * `vite build` produces dist/server/server.js whose default export is a
 * Web Fetch handler `{ fetch(request: Request): Promise<Response> }` — it does
 * not bind a port itself (the dev/preview path uses Vite's preview server; in
 * production there is no Nitro/.output host in this stack). This file is the
 * smallest dependency-free host: a Node http.Server that serves dist/client
 * static assets directly and forwards everything else to the SSR handler.
 *
 * Runtime configuration comes from the environment (no baked secrets):
 *   PORT              TCP port (default 3000); invalid values fall back to 3000
 *   HOST              bind address (default 0.0.0.0)
 *   OBITER_WEB_ORIGIN trusted public origin used to construct the request URL
 *                     (e.g. https://app.example.com). When set, it takes
 *                     precedence over the client-supplied Host header, which is
 *                     forgeable if the container is reachable without Traefik.
 *                     With same-domain routing this is just the site origin.
 *   BETTER_AUTH_URL   consumed by the auth client (same-domain => site origin)
 *
 * Same-domain routing: a reverse proxy (Dokploy/Traefik) sends `/*` here and
 * `/api/*` to the API app, so this server only renders the web app.
 *
 * The pure helpers (parsePort, resolveBaseUrl, applyResponseHeaders) are
 * exported for unit testing; the server bootstrap lives in the default export.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

export const DEFAULT_PORT = 3000
export const DEFAULT_HOST = '0.0.0.0'

/**
 * Parse PORT into a usable integer. Accepts only decimal integer strings;
 * anything else (NaN, hex, scientific notation, out of range, non-integer,
 * empty string) falls back to DEFAULT_PORT. Returns the fallback for anything
 * that would otherwise produce a surprising or broken listen().
 */
export function parsePort(raw, fallback = DEFAULT_PORT) {
  if (raw === undefined || raw === null || raw === '') return fallback
  // Reject anything that isn't a plain decimal integer (no 0x, no 1e3).
  if (!/^[0-9]+$/.test(String(raw))) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return fallback
  return parsed
}

/**
 * Resolve the absolute URL for an incoming request. Prefers a configured
 * trusted origin (OBITER_WEB_ORIGIN) over the forgeable Host header.
 * Returns a URL with the request path + search preserved.
 */
export function resolveBaseUrl(webOrigin, hostHeader) {
  if (webOrigin) {
    try {
      // Validate it parses as an origin; drop any path component.
      const parsed = new URL(webOrigin)
      return `${parsed.protocol}//${parsed.host}`
    } catch {
      // Fall through to Host header if the configured origin is malformed.
    }
  }
  return hostHeader ? `http://${hostHeader}` : `http://${DEFAULT_HOST}`
}

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Apply a Web Response's headers onto a Node ServerResponse, then write the
 * status line. Set-Cookie is handled specially: a Response may carry multiple
 * Set-Cookie headers (better-auth emits several), which must NOT be collapsed
 * into a single value. undici's getSetCookie() returns them as an array.
 *
 * Other headers are set individually via setHeader before writeHead. Returns
 * the ServerResponse for chaining.
 */
export function applyResponseHeaders(res, webRes) {
  const setCookies = typeof webRes.headers.getSetCookie === 'function'
    ? webRes.headers.getSetCookie()
    : []
  const cookieHeader = webRes.headers.get('set-cookie')
  const cookies = setCookies.length > 0
    ? setCookies
    : (cookieHeader ? [cookieHeader] : [])

  if (cookies.length > 0) {
    res.setHeader('set-cookie', cookies)
  }

  // Set every other header individually (preserving multiples where Node
  // supports them). Skip content-length — the stream owns framing here, and
  // Node recomputes it for chunked responses.
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    if (key.toLowerCase() === 'content-length') return
    res.setHeader(key, value)
  })

  res.writeHead(webRes.status, webRes.statusText)
  return res
}

/**
 * Stream a Web Response body into a Node ServerResponse using Node core
 * stream primitives. Readable.fromWeb bridges the Web ReadableStream to a Node
 * stream; pipeline wires up error propagation, backpressure (slow clients no
 * longer balloon memory), and clean teardown on client disconnect.
 *
 * Resolves on a clean end; rejects on a stream/socket error (caller logs and
 * destroys the response).
 */
export function streamResponse(res, webRes) {
  if (!webRes.body) {
    res.end()
    return Promise.resolve()
  }
  const nodeStream = Readable.fromWeb(webRes.body)
  return pipeline(nodeStream, res, { end: true })
}

export function createServeOptions({ getStaticAsset } = {}) {
  return { getStaticAsset: getStaticAsset ?? null }
}

/**
 * Build the production request handler. Static-asset reads come from a
 * pluggable lookup so tests can inject fixtures without touching disk.
 */
export function createRequestHandler(handle, { clientDir, webOrigin } = {}) {
  return async (req, res) => {
    const base = resolveBaseUrl(
      webOrigin ?? process.env.OBITER_WEB_ORIGIN,
      req.headers.host,
    )
    let url
    try {
      url = new URL(req.url, base)
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Bad Request\n')
      return
    }

    try {
      // Serve client static assets directly; anything else is SSR.
      if (url.pathname.startsWith('/assets/') && clientDir) {
        const staticRes = await serveStatic(url.pathname, clientDir)
        if (staticRes) {
          applyResponseHeaders(res, staticRes)
          await streamResponse(res, staticRes)
          return
        }
      }

      const headers = nodeRequestHeaders(req)
      const webReq = new Request(url, { method: req.method, headers })
      const webRes = await handle(webReq)
      applyResponseHeaders(res, webRes)
      await streamResponse(res, webRes)
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      }
      res.end('Internal Server Error\n')
      console.error('[serve] request failed:', error)
    }
  }
}

function nodeRequestHeaders(req) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else if (value != null) headers.set(key, value)
  }
  return headers
}

async function serveStatic(pathname, clientDir) {
  // Guard against path traversal.
  if (pathname.includes('..') || pathname.includes('\0')) return null
  const filePath = join(clientDir, pathname)
  try {
    const body = await readFile(filePath)
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    return new Response(body, {
      headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' },
    })
  } catch {
    return null
  }
}

/**
 * Default server bootstrap. Imports the built SSR handler, wires the request
 * handler, and listens on HOST:PORT.
 */
export async function start() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const serverModulePath = join(__dirname, 'dist', 'server', 'server.js')

  // Dynamic import needs a file:// URL on Windows; bare absolute paths fail.
  const handlerModule = await import(pathToFileURL(serverModulePath).href)
  const handle = handlerModule.default?.fetch ?? handlerModule.fetch
  if (typeof handle !== 'function') {
    throw new Error(
      `Expected the built server module to export a fetch handler. Loaded: ${serverModulePath}`,
    )
  }

  const clientDir = join(__dirname, 'dist', 'client')
  const port = parsePort(process.env.PORT)
  const host = process.env.HOST ?? DEFAULT_HOST

  if (process.env.PORT !== undefined && String(process.env.PORT) !== String(port)) {
    console.warn(
      `[obiter-web] invalid PORT="${process.env.PORT}", falling back to ${port}`,
    )
  }

  const requestHandler = createRequestHandler(handle, { clientDir })
  const server = createServer(requestHandler)

  server.listen(port, host, () => {
    console.log(`[obiter-web] listening on http://${host}:${port}`)
  })
  return server
}

// Run only when invoked directly (`node serve.mjs`), not when imported by tests.
// pathToFileURL normalizes the cross-platform comparison (Windows paths vs file:// URLs).
import { pathToFileURL as _pathToFileURL } from 'node:url'
const invokedScript = process.argv[1]
const isMain = invokedScript && _pathToFileURL(invokedScript).href === import.meta.url
if (isMain) {
  start().catch((error) => {
    console.error('[obiter-web] failed to start:', error)
    process.exit(1)
  })
}
