/*
 * Disposable synthetic API target for the SSR/proxy API-origin repro.
 *
 * Every request is appended to <log> as: <name> <method> <url>
 *
 * Target A is the intended lane backend: GET /api/me returns a valid
 * MeResponse so an authenticated direct load of /settings renders.
 * Target B is the "other backend" sink: its GET /api/me returns a realistic
 * 401 unauthenticated envelope, which is what an SSR request hitting the wrong
 * stack sees. B is synthetic; the shared dev API is never used.
 */
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const [name, portRaw, log] = process.argv.slice(2)
const port = Number(portRaw)

const me = {
  user: {
    id: `user_${name}`,
    email: `${name.toLowerCase()}@synthetic.test`,
    name: `Synthetic ${name}`,
    role: null,
  },
  organisation: null,
}

const unauthenticated = {
  error: {
    code: 'unauthenticated',
    message: 'Not authenticated.',
    requestId: `req_${name.toLowerCase()}`,
  },
}

createServer((req, res) => {
  appendFileSync(log, `${name} ${req.method} ${req.url}\n`)
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/api/me') {
    if (name === 'B') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify(unauthenticated))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(me))
    return
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', target: name }))
    return
  }
  if (url.pathname === '/api/auth/get-session') {
    res.writeHead(200, { 'content-type': 'application/json' })
    if (name === 'B') {
      res.end('null')
      return
    }
    res.end(
      JSON.stringify({
        session: {
          id: `session_${name}`,
          token: `token_${name}`,
          userId: `user_${name}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          ipAddress: '127.0.0.1',
          userAgent: 'synthetic',
        },
        user: {
          id: `user_${name}`,
          email: `${name.toLowerCase()}@synthetic.test`,
          name: `Synthetic ${name}`,
          emailVerified: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    )
    return
  }
  if (url.pathname.startsWith('/api/auth/')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('null')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ target: name, path: url.pathname }))
}).listen(port, '127.0.0.1', () => {
  console.log(`${name} listening on 127.0.0.1:${port}`)
})
