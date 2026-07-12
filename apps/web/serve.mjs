/*
 * Production server bootstrap for @obiter/web (TanStack Start SSR).
 *
 * `vite build` produces dist/server/server.js whose default export is a
 * Web Fetch handler `{ fetch(request: Request): Promise<Response> }` — it does
 * not bind a port itself (the dev/preview path uses Vite's preview server; in
 * production there is no Nitro/.output host in this stack). This file is the
 * smallest dependency-free host: a Node http.Server that translates each Node
 * request into a Web Request, calls the built handler, and streams the Web
 * Response back. No runtime dependencies are added.
 *
 * Runtime configuration comes from the environment (no baked secrets):
 *   PORT            TCP port (default 3000)
 *   HOST            bind address (default 0.0.0.0)
 *   BETTER_AUTH_URL public base URL consumed by the auth client / apiFetch
 *                   (same-domain routing means this is just the site origin)
 *
 * Same-domain routing: a reverse proxy (Dokploy/Traefik) sends `/*` here and
 * `/api/*` to the API app, so this server only renders the web app — it does
 * not proxy the API.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

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

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

/**
 * Static asset serving for dist/client. TanStack Start serves client assets
 * under /assets/*; we serve them straight off disk so the production host does
 * not depend on a separate static-file server. Anything else is handed to the
 * SSR handler.
 */
const clientDir = join(__dirname, 'dist', 'client')

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

async function serveStatic(pathname) {
  if (pathname.includes('..')) return null
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

const server = createServer(async (req, res) => {
  try {
    // Build a Web Request from the Node request (body streaming is unnecessary
    // for an SSR renderer that only reads GETs for document/navigation fetches).
    const url = new URL(req.url, `http://${req.headers.host ?? HOST}`)
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
      else if (value != null) headers.set(key, value)
    }

    if (url.pathname.startsWith('/assets/')) {
      const staticRes = await serveStatic(url.pathname)
      if (staticRes) return writeResponse(res, staticRes)
    }

    const webRes = await handle(new Request(url, { method: req.method, headers }))
    writeResponse(res, webRes)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Internal Server Error\n`)
    console.error('[serve] request failed:', error)
  }
})

function writeResponse(res, webRes) {
  const headers = {}
  webRes.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(webRes.status, webRes.statusText, headers)
  if (!webRes.body) {
    res.end()
    return
  }
  // Stream the Web ReadableStream back into the Node response.
  const reader = webRes.body.getReader()
  const pump = () =>
    reader.read().then(({ done, value }) => {
      if (done) {
        res.end()
        return
      }
      res.write(value)
      pump()
    }, pump)
  pump()
}

server.listen(PORT, HOST, () => {
  console.log(`[obiter-web] listening on http://${HOST}:${PORT}`)
})
