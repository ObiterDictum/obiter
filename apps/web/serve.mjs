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
 *   OBITER_BUILD_PROVENANCE=1 exposes the build marker at
 *                     GET /.well-known/obiter-build. The measurement harness
 *                     sets it to prove the running process loaded the artifact
 *                     it is about to measure. Unset (production default) the
 *                     path is not routed here at all.
 *
 * Same-domain routing: a reverse proxy (Dokploy/Traefik) sends `/*` here and
 * `/api/*` to the API app, so this server only renders the web app.
 *
 * The pure host helpers (parsePort, resolveBaseUrl, applyResponseHeaders) are
 * exported for unit testing; content-coding and cache policy live in
 * http-policy.mjs. The server bootstrap lives in the default export at the
 * bottom.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip, gzipSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, dirname, join } from 'node:path'
import { verifyArtifactIntegrity } from './build-provenance.mjs'
import {
  COMPRESSIBLE_EXTENSIONS,
  cacheControlFor,
  mergeVary,
  negotiateEncoding,
  strictestCacheControl,
} from './http-policy.mjs'

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

// Gzip is cached per process, keyed by path plus the file's size and mtime so
// a changed file can never serve stale compressed bytes. The map is a bounded
// LRU: the least recently used entry is evicted rather than clearing wholesale.
const gzipCache = new Map()
const GZIP_CACHE_LIMIT = 128

function gzipAsset(key, body) {
  const cached = gzipCache.get(key)
  if (cached !== undefined) {
    gzipCache.delete(key)
    gzipCache.set(key, cached)
    return cached
  }
  const compressed = gzipSync(body)
  if (gzipCache.size >= GZIP_CACHE_LIMIT) {
    gzipCache.delete(gzipCache.keys().next().value)
  }
  gzipCache.set(key, compressed)
  return compressed
}

/**
 * Apply a Web Response's headers onto a Node ServerResponse, then write the
 * status line. Set-Cookie is handled specially: a Response may carry multiple
 * Set-Cookie headers (better-auth emits several), which must NOT be collapsed
 * into a single value. undici's getSetCookie() returns them as an array.
 *
 * `extraHeaders` are applied after the upstream headers, but two of them are
 * merged rather than replaced: `vary` is unioned, and `cache-control` keeps the
 * more restrictive value so a handler's `private`/`no-store` cannot be weakened
 * by this host (or vice versa). `content-encoding` is never applied over one the
 * handler already set, so a pre-encoded body is never gzipped twice.
 *
 * `dropContentLength` is for the SSR path, where the body is streamed (and may
 * be compressed) so Node owns framing. Static assets pass their own known
 * length.
 */
export function applyResponseHeaders(
  res,
  webRes,
  extraHeaders,
  { dropContentLength = false } = {},
) {
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
  // supports them). Skip content-length when the stream owns framing.
  webRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie') return
    if (dropContentLength && lower === 'content-length') return
    res.setHeader(key, value)
  })

  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (lower === 'vary') {
      res.setHeader('vary', mergeVary(res.getHeader?.('vary'), value))
      continue
    }
    if (lower === 'cache-control') {
      res.setHeader(
        'cache-control',
        strictestCacheControl(res.getHeader?.('cache-control'), value),
      )
      continue
    }
    if (lower === 'content-encoding' && res.getHeader?.('content-encoding')) {
      continue
    }
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
 * destroys the response). Node suppresses the body itself for HEAD requests,
 * leaving the headers (including Content-Length) intact.
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

/**
 * Build the production request handler. Static-asset reads come from a
 * pluggable `clientDir` so tests can inject fixtures without touching disk.
 * `immutableAssets` is the set of filenames the build recorded as content
 * hashed; only those may be cached immutably. `buildProvenance` is served at
 * GET /.well-known/obiter-build when provided.
 */
export function createRequestHandler(
  handle,
  { clientDir, webOrigin, immutableAssets, buildProvenance } = {},
) {
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

    const accepted = negotiateEncoding(req.headers['accept-encoding'])
    if (!accepted.gzip && !accepted.identity) {
      res.writeHead(406, {
        'content-type': 'text/plain; charset=utf-8',
        vary: 'Accept-Encoding',
      })
      res.end('Not Acceptable\n')
      return
    }

    try {
      if (url.pathname === '/.well-known/obiter-build' && buildProvenance) {
        const body = JSON.stringify(buildProvenance)
        const provenanceRes = new Response(body, {
          headers: { 'content-type': 'application/json' },
        })
        applyResponseHeaders(res, provenanceRes, {
          'cache-control': 'private, no-store',
          'content-length': String(Buffer.byteLength(body)),
        })
        await streamResponse(res, provenanceRes)
        return
      }

      // Serve client static assets directly; anything else is SSR.
      if (url.pathname.startsWith('/assets/') && clientDir) {
        const staticRes = await serveStatic(
          url.pathname,
          clientDir,
          accepted,
          immutableAssets,
        )
        if (staticRes) {
          applyResponseHeaders(res, staticRes)
          await streamResponse(res, staticRes)
          return
        }
      }

      const headers = nodeRequestHeaders(req)
      const webReq = new Request(url, { method: req.method, headers })
      const webRes = await handle(webReq)
      const isHtml = (webRes.headers.get('content-type') ?? '').includes(
        'text/html',
      )
      // A body the handler already encoded is passed through untouched. When
      // identity is refused and gzip is not, the only acceptable coding is
      // gzip even for a non-HTML response.
      const alreadyEncoded = webRes.headers.has('content-encoding')
      const compress =
        accepted.gzip && !alreadyEncoded && (isHtml || !accepted.identity)
      // SSR output is per-session; never let a shared cache keep it.
      applyResponseHeaders(
        res,
        webRes,
        {
          'cache-control': 'private, no-store',
          vary: 'Accept-Encoding',
          ...(compress ? { 'content-encoding': 'gzip' } : {}),
        },
        { dropContentLength: true },
      )
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

async function serveStatic(pathname, clientDir, accepted, immutableAssets) {
  // Guard against path traversal.
  if (pathname.includes('..') || pathname.includes('\0')) return null
  const filePath = join(clientDir, pathname)
  let info
  let body
  try {
    info = await stat(filePath)
    if (!info.isFile()) return null
    body = await readFile(filePath)
  } catch {
    return null
  }
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const hashed = immutableAssets?.has(basename(filePath)) ?? false
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': cacheControlFor(hashed),
    vary: 'Accept-Encoding',
  }
  const compress = accepted.gzip && COMPRESSIBLE_EXTENSIONS.has(ext)
  if (compress || !accepted.identity) {
    const compressed = gzipAsset(
      `${filePath}\0${info.size}\0${info.mtimeMs}`,
      body,
    )
    return new Response(compressed, {
      headers: {
        ...headers,
        'content-encoding': 'gzip',
        'content-length': String(compressed.length),
      },
    })
  }
  return new Response(body, {
    headers: { ...headers, 'content-length': String(body.length) },
  })
}

/**
 * Default server bootstrap. Imports the built SSR handler, verifies the artifact
 * against its build provenance, wires the request handler, and listens on
 * HOST:PORT.
 */
export async function start() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const serverModulePath = join(__dirname, 'dist', 'server', 'server.js')
  const distDir = join(__dirname, 'dist')

  // The marker describes what was built. A missing marker is warned about (an
  // ad-hoc build without the supported command); a marker whose digest does not
  // match the client bytes on disk is refused, because serving it would present
  // files as an artifact they are not. The digest covers dist/client/assets
  // only; the emitted server bundle is not digested (known limitation).
  let marker = null
  try {
    marker = await verifyArtifactIntegrity(distDir)
  } catch (error) {
    if (await hasMarker(distDir)) throw error
    console.warn(
      `[obiter-web] no build provenance in ${distDir}: ${error.message}`,
    )
  }

  // Dynamic import needs a file:// URL on Windows; bare absolute paths fail.
  const handlerModule = await import(pathToFileURL(serverModulePath).href)
  const handle = handlerModule.default?.fetch ?? handlerModule.fetch
  if (typeof handle !== 'function') {
    throw new Error(
      `Expected the built server module to export a fetch handler. Loaded: ${serverModulePath}`,
    )
  }

  const clientDir = join(distDir, 'client')
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

  const requestHandler = createRequestHandler(handle, {
    clientDir,
    immutableAssets: new Set(marker?.hashedAssets ?? []),
    buildProvenance:
      process.env.OBITER_BUILD_PROVENANCE === '1' && marker ? marker : null,
  })
  const server = createServer(requestHandler)

  server.listen(port, host, () => {
    console.log(`[obiter-web] listening on http://${host}:${port}`)
  })
  return server
}

async function hasMarker(distDir) {
  try {
    await stat(join(distDir, '.obiter-build.json'))
    return true
  } catch {
    return false
  }
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
