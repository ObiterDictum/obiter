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
import { createGzip, gzipSync } from 'node:zlib'
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
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)
    return fallback
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

/*
 * Vite writes every file under /assets with a content hash in its name, so the
 * bytes behind a given URL never change. Without a cache directive the browser
 * refetches all of them on every navigation and reload (measured: the warm-cache
 * run transferred the same 1.4 MB as the cold one), which is the largest
 * repeat-visit cost in the app. `immutable` also stops the browser revalidating
 * on reload. Non-hashed paths (the PDF worker is hashed too, but a future
 * unhashed file would not be) fall back to a short revalidating policy.
 */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

// Text-like assets that compress well. Fonts are already compressed; images
// are not worth the CPU here.
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
])

/** True when the client advertised gzip in Accept-Encoding. */
export function acceptsGzip(header) {
  if (typeof header !== 'string') return false
  return header
    .split(',')
    .some((part) => part.trim().split(';')[0].toLowerCase() === 'gzip')
}

/**
 * Cache directive for a served file. `hashed` is whether the path carries a
 * Vite content hash, which is what makes an immutable directive honest.
 */
export function cacheControlFor(hashed) {
  return hashed ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL
}

const gzipCache = new Map()
const GZIP_CACHE_LIMIT = 128

/** Gzip an asset once per process; the bytes are immutable for a given path. */
function gzipAsset(path, body) {
  const cached = gzipCache.get(path)
  if (cached) return cached
  const compressed = gzipSync(body)
  if (gzipCache.size >= GZIP_CACHE_LIMIT) gzipCache.clear()
  gzipCache.set(path, compressed)
  return compressed
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
export function applyResponseHeaders(res, webRes, extraHeaders) {
  const setCookies =
    typeof webRes.headers.getSetCookie === 'function'
      ? webRes.headers.getSetCookie()
      : []
  const cookieHeader = webRes.headers.get('set-cookie')
  const cookies =
    setCookies.length > 0 ? setCookies : cookieHeader ? [cookieHeader] : []

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

  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    if (value === undefined) continue
    res.setHeader(key, value)
  }

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
export function streamResponse(res, webRes, { compress = false } = {}) {
  if (!webRes.body) {
    res.end()
    return Promise.resolve()
  }
  const nodeStream = Readable.fromWeb(webRes.body)
  if (compress) {
    return pipeline(nodeStream, createGzip(), res, { end: true })
  }
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

    const gzipOk = acceptsGzip(req.headers['accept-encoding'])

    try {
      // Serve client static assets directly; anything else is SSR.
      if (url.pathname.startsWith('/assets/') && clientDir) {
        const staticRes = await serveStatic(url.pathname, clientDir, gzipOk)
        if (staticRes) {
          applyResponseHeaders(res, staticRes)
          await streamResponse(res, staticRes)
          return
        }
      }

      const headers = nodeRequestHeaders(req)
      const webReq = new Request(url, { method: req.method, headers })
      const webRes = await handle(webReq)
      // SSR output is per-session; never let a shared cache keep it. Compress
      // the HTML stream because it is sent on every navigation.
      const isHtml = (webRes.headers.get('content-type') ?? '').includes(
        'text/html',
      )
      const compress = isHtml && gzipOk
      applyResponseHeaders(res, webRes, {
        'cache-control': 'private, no-store',
        vary: 'Accept-Encoding',
        ...(compress ? { 'content-encoding': 'gzip' } : {}),
      })
      await streamResponse(res, webRes, { compress })
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

async function serveStatic(pathname, clientDir, gzipOk) {
  // Guard against path traversal.
  if (pathname.includes('..') || pathname.includes('\0')) return null
  const filePath = join(clientDir, pathname)
  let body
  try {
    body = await readFile(filePath)
  } catch {
    return null
  }
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Vite hashes every filename under /assets, so the bytes for a URL are
    // immutable; a hashed-layout path is the only one served here.
    'cache-control': cacheControlFor(/-[0-9a-zA-Z_-]{8,}\./.test(filePath)),
    vary: 'Accept-Encoding',
  }
  if (gzipOk && COMPRESSIBLE_EXTENSIONS.has(ext)) {
    return new Response(gzipAsset(filePath, body), {
      headers: { ...headers, 'content-encoding': 'gzip' },
    })
  }
  return new Response(body, { headers })
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

  if (
    process.env.PORT !== undefined &&
    String(process.env.PORT) !== String(port)
  ) {
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
const isMain =
  invokedScript && _pathToFileURL(invokedScript).href === import.meta.url
if (isMain) {
  start().catch((error) => {
    console.error('[obiter-web] failed to start:', error)
    process.exit(1)
  })
}
