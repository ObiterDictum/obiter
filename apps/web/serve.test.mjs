/*
 * Focused unit tests for the production SSR host helpers (serve.mjs).
 *
 * Uses Node's built-in test runner (node:test) — no new dependency. Covers the
 * pure helpers that carry the correctness load: PORT parsing (B4), Set-Cookie
 * array handling (B6), trusted-origin URL resolution (W1), Accept-Encoding
 * negotiation (RFC 9110 §12.5.3), header ownership, and per-file gzip caching.
 * The streaming path itself delegates to Node core and is exercised here through
 * a real HTTP server over a fixture client directory.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { brotliCompressSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PORT,
  applyResponseHeaders,
  createRequestHandler,
  parsePort,
  resolveBaseUrl,
} from './serve.mjs'
import {
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
} from './http-policy.mjs'

test('parsePort', async (t) => {
  await t.test('returns the default for empty/undefined/null', () => {
    assert.equal(parsePort(undefined), DEFAULT_PORT)
    assert.equal(parsePort(null), DEFAULT_PORT)
    assert.equal(parsePort(''), DEFAULT_PORT)
  })

  await t.test('parses valid integer port strings', () => {
    assert.equal(parsePort('3000'), 3000)
    assert.equal(parsePort('8080'), 8080)
    assert.equal(parsePort('1'), 1)
    assert.equal(parsePort('65535'), 65535)
  })

  await t.test('falls back to default for non-integer input (B4)', () => {
    assert.equal(parsePort('abc'), DEFAULT_PORT)
    assert.equal(parsePort('80.5'), DEFAULT_PORT)
    assert.equal(parsePort('1e3'), DEFAULT_PORT)
  })

  await t.test('falls back to default for out-of-range ports (B4)', () => {
    assert.equal(parsePort('0'), DEFAULT_PORT)
    assert.equal(parsePort('-1'), DEFAULT_PORT)
    assert.equal(parsePort('65536'), DEFAULT_PORT)
    assert.equal(parsePort('100000'), DEFAULT_PORT)
  })

  await t.test('accepts a custom fallback', () => {
    assert.equal(parsePort('abc', 9000), 9000)
    assert.equal(parsePort('70000', 9000), 9000)
  })
})

test('resolveBaseUrl', async (t) => {
  await t.test('prefers a trusted configured origin over Host (W1)', () => {
    const base = resolveBaseUrl('https://app.example.com', 'evil.attacker')
    assert.equal(base, 'https://app.example.com')
  })

  await t.test('strips any path on the configured origin', () => {
    const base = resolveBaseUrl('https://app.example.com/some/path', 'evil')
    assert.equal(base, 'https://app.example.com')
  })

  await t.test('falls back to the Host header when no origin is set', () => {
    assert.equal(
      resolveBaseUrl(undefined, 'app.example.com'),
      'http://app.example.com',
    )
  })

  await t.test('falls back to default host when both are absent', () => {
    assert.equal(resolveBaseUrl(undefined, undefined), 'http://0.0.0.0')
  })

  await t.test('falls back to Host when origin is malformed', () => {
    assert.equal(
      resolveBaseUrl('not-a-url', 'app.example.com'),
      'http://app.example.com',
    )
  })
})

test('applyResponseHeaders — Set-Cookie handling (B6)', async (t) => {
  function makeRes(initial = {}) {
    const stored = { ...initial }
    return {
      setHeader(name, value) {
        stored[name] = value
      },
      getHeader(name) {
        return stored[name]
      },
      writeHead(status, statusText) {
        stored.__status = status
        stored.__statusText = statusText
      },
      get headerValues() {
        return stored
      },
    }
  }

  await t.test('preserves multiple Set-Cookie headers as an array', () => {
    const res = makeRes()
    // Real fetch responses carry multiple Set-Cookie values as separate header
    // entries; Headers.append (not an object literal) reproduces that shape.
    const headers = new Headers()
    headers.append('set-cookie', 'session=abc; Path=/')
    headers.append('set-cookie', 'csrf=xyz; Path=/')
    headers.set('content-type', 'text/plain')
    const webRes = new Response('ok', { headers })
    applyResponseHeaders(res, webRes)
    assert.deepEqual(res.headerValues['set-cookie'], [
      'session=abc; Path=/',
      'csrf=xyz; Path=/',
    ])
  })

  await t.test('handles a single Set-Cookie as a one-element array', () => {
    const res = makeRes()
    const webRes = new Response('ok', {
      headers: { 'set-cookie': 'session=abc; Path=/' },
    })
    applyResponseHeaders(res, webRes)
    assert.deepEqual(res.headerValues['set-cookie'], ['session=abc; Path=/'])
  })

  await t.test('does not set set-cookie when absent', () => {
    const res = makeRes()
    const webRes = new Response('ok', {
      headers: { 'content-type': 'text/plain' },
    })
    applyResponseHeaders(res, webRes)
    assert.equal(res.headerValues['set-cookie'], undefined)
  })

  await t.test(
    'writes other headers individually and sets the status line',
    () => {
      const res = makeRes()
      const webRes = new Response('ok', {
        status: 201,
        headers: { 'content-type': 'text/plain', 'x-custom': 'yes' },
      })
      applyResponseHeaders(res, webRes)
      assert.equal(res.headerValues['content-type'], 'text/plain')
      assert.equal(res.headerValues['x-custom'], 'yes')
      assert.equal(res.headerValues.__status, 201)
    },
  )

  await t.test('merges vary instead of replacing the handler value', () => {
    const res = makeRes()
    const webRes = new Response('ok', {
      headers: { 'content-type': 'text/html', vary: 'Cookie' },
    })
    applyResponseHeaders(res, webRes, { vary: 'Accept-Encoding' })
    assert.equal(res.headerValues.vary, 'Cookie, Accept-Encoding')
  })

  await t.test('keeps a stricter upstream cache policy', () => {
    const res = makeRes()
    const webRes = new Response('ok', {
      headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
    })
    applyResponseHeaders(res, webRes, {
      'cache-control': 'public, max-age=31536000, immutable',
    })
    assert.equal(res.headerValues['cache-control'], 'no-store')
  })

  await t.test('never applies a second content-encoding', () => {
    const res = makeRes()
    const webRes = new Response('ok', {
      headers: { 'content-type': 'text/html', 'content-encoding': 'br' },
    })
    applyResponseHeaders(res, webRes, { 'content-encoding': 'gzip' })
    assert.equal(res.headerValues['content-encoding'], 'br')
  })

  await t.test('drops an upstream content-length only when streaming', () => {
    const res = makeRes()
    const webRes = new Response('ok', {
      headers: { 'content-length': '2', 'content-type': 'text/html' },
    })
    applyResponseHeaders(res, webRes, undefined, { dropContentLength: true })
    assert.equal(res.headerValues['content-length'], undefined)
  })
})

test('createRequestHandler over a real server', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'obiter-serve-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(
    join(dir, 'assets', 'app-12345678.js'),
    'export const x = 1\n',
  )
  await writeFile(join(dir, 'assets', 'unhashed.js'), 'export const y = 2\n')
  const ssrHtml = '<!doctype html><html><body>hi</body></html>'
  let ssrBody = ssrHtml
  let ssrHeaders = { 'content-type': 'text/html; charset=utf-8' }
  const handler = createRequestHandler(
    () => new Response(ssrBody, { headers: ssrHeaders }),
    { clientDir: dir, immutableAssets: new Set(['app-12345678.js']) },
  )
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  try {
    await t.test(
      'recorded hashed assets are immutable and gzipped',
      async () => {
        const res = await fetch(`${origin}/assets/app-12345678.js`, {
          headers: { 'accept-encoding': 'gzip' },
        })
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('content-encoding'), 'gzip')
        assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL)
        assert.match(res.headers.get('vary') ?? '', /Accept-Encoding/i)
        const body = Buffer.from(await res.arrayBuffer())
        assert.ok(Number(res.headers.get('content-length')) > 0)
        assert.equal(body.toString(), 'export const x = 1\n')
      },
    )

    await t.test(
      'a file not recorded as hashed is only revalidated',
      async () => {
        const res = await fetch(`${origin}/assets/unhashed.js`, {
          headers: { 'accept-encoding': 'identity' },
        })
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('cache-control'), REVALIDATE_CACHE_CONTROL)
      },
    )

    await t.test('gzip;q=0 receives identity bytes', async () => {
      const res = await fetch(`${origin}/assets/app-12345678.js`, {
        headers: { 'accept-encoding': 'gzip;q=0' },
      })
      assert.equal(res.headers.get('content-encoding'), null)
      assert.equal(await res.text(), 'export const x = 1\n')
    })

    await t.test('identity;q=0 with gzip refused gets 406', async () => {
      const res = await fetch(`${origin}/sign-in`, {
        headers: { 'accept-encoding': 'identity;q=0, gzip;q=0' },
      })
      assert.equal(res.status, 406)
      assert.match(res.headers.get('vary') ?? '', /Accept-Encoding/i)
    })

    await t.test(
      'a missing asset falls through to SSR, not a 404',
      async () => {
        const res = await fetch(`${origin}/assets/missing-99999999.js`)
        assert.equal(res.status, 200)
        assert.match(res.headers.get('content-type') ?? '', /text\/html/)
      },
    )

    await t.test('SSR HTML is private and gzipped', async () => {
      const res = await fetch(`${origin}/sign-in`, {
        headers: { 'accept-encoding': 'gzip' },
      })
      assert.equal(res.headers.get('cache-control'), 'private, no-store')
      assert.equal(res.headers.get('content-encoding'), 'gzip')
      assert.equal(await res.text(), ssrHtml)
    })

    await t.test('a client without gzip gets identity bytes', async () => {
      const res = await fetch(`${origin}/sign-in`, {
        headers: { 'accept-encoding': 'identity' },
      })
      assert.equal(res.headers.get('content-encoding'), null)
      assert.equal(await res.text(), ssrHtml)
    })

    await t.test('HEAD keeps headers and sends no body', async () => {
      const res = await fetch(`${origin}/assets/app-12345678.js`, {
        method: 'HEAD',
        headers: { 'accept-encoding': 'gzip' },
      })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-encoding'), 'gzip')
      assert.ok(Number(res.headers.get('content-length')) > 0)
      assert.equal(await res.text(), '')
    })

    await t.test(
      'a pre-encoded handler body is not double-compressed',
      async () => {
        ssrBody = brotliCompressSync(ssrHtml)
        ssrHeaders = {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'br',
        }
        const res = await fetch(`${origin}/sign-in`, {
          headers: { 'accept-encoding': 'gzip' },
        })
        assert.equal(res.headers.get('content-encoding'), 'br')
        assert.equal(await res.text(), ssrHtml)
        ssrBody = ssrHtml
        ssrHeaders = { 'content-type': 'text/html; charset=utf-8' }
      },
    )

    await t.test('the gzip cache follows a changed file', async () => {
      const path = join(dir, 'assets', 'app-12345678.js')
      await writeFile(path, 'export const x = 1\n')
      const first = await fetch(`${origin}/assets/app-12345678.js`, {
        headers: { 'accept-encoding': 'gzip' },
      })
      assert.equal(await first.text(), 'export const x = 1\n')
      await writeFile(path, 'export const changed = true\n')
      const second = await fetch(`${origin}/assets/app-12345678.js`, {
        headers: { 'accept-encoding': 'gzip' },
      })
      assert.equal(await second.text(), 'export const changed = true\n')
    })

    await t.test('a disallowed file is not served', async () => {
      const res = await fetch(`${origin}/assets/..%2Fserve.mjs`)
      assert.notEqual(res.headers.get('content-type'), 'text/javascript')
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
