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

export function parsePort(raw, fallback = DEFAULT_PORT) {
  if (raw === undefined || raw === null || raw === '') return fallback
  if (!/^[0-9]+$/.test(String(raw))) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)
    return fallback
  return parsed
}

export function resolveBaseUrl(webOrigin, hostHeader) {
  if (webOrigin) {
    try {
      const parsed = new URL(webOrigin)
      return `${parsed.protocol}//${parsed.host}`
    } catch {}
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
      const alreadyEncoded = webRes.headers.has('content-encoding')
      const compress =
        accepted.gzip && !alreadyEncoded && (isHtml || !accepted.identity)
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

export async function start() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const serverModulePath = join(__dirname, 'dist', 'server', 'server.js')
  const distDir = join(__dirname, 'dist')

  let marker = null
  try {
    marker = await verifyArtifactIntegrity(distDir)
  } catch (error) {
    if (await hasMarker(distDir)) throw error
    console.warn(
      `[obiter-web] no build provenance in ${distDir}: ${error.message}`,
    )
  }

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
