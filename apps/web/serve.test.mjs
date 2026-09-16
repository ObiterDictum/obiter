/*
 * Focused unit tests for the production SSR host helpers (serve.mjs).
 *
 * Uses Node's built-in test runner (node:test) — no new dependency. Covers the
 * pure helpers that carry the correctness load: PORT parsing (B4), Set-Cookie
 * array handling (B6), and trusted-origin URL resolution (W1). The streaming
 * path itself delegates to Node core (stream/promises pipeline + Readable.fromWeb)
 * and is not re-tested here; it is exercised end-to-end against a real build.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PORT,
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  acceptsGzip,
  applyResponseHeaders,
  cacheControlFor,
  createRequestHandler,
  parsePort,
  resolveBaseUrl,
} from './serve.mjs'

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
    const base = resolveBaseUrl(undefined, 'app.example.com')
    assert.equal(base, 'http://app.example.com')
  })

  await t.test('falls back to default host when both are absent', () => {
    const base = resolveBaseUrl(undefined, undefined)
    assert.equal(base, 'http://0.0.0.0')
  })

  await t.test('falls back to Host when origin is malformed', () => {
    const base = resolveBaseUrl('not-a-url', 'app.example.com')
    assert.equal(base, 'http://app.example.com')
  })
})

test('applyResponseHeaders — Set-Cookie handling (B6)', async (t) => {
  function makeRes() {
    const stored = {}
    return {
      setHeader(name, value) {
        stored[name] = value
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
})

test('cache and compression helpers', async (t) => {
  await t.test('acceptsGzip only matches a gzip token', () => {
    assert.equal(acceptsGzip('gzip'), true)
    assert.equal(acceptsGzip('br, gzip;q=1.0'), true)
    assert.equal(acceptsGzip('GZIP'), true)
    assert.equal(acceptsGzip('br, deflate'), false)
    assert.equal(acceptsGzip(''), false)
    assert.equal(acceptsGzip(undefined), false)
  })

  await t.test('cacheControlFor is immutable only for hashed paths', () => {
    assert.equal(cacheControlFor(true), IMMUTABLE_CACHE_CONTROL)
    assert.equal(cacheControlFor(false), REVALIDATE_CACHE_CONTROL)
    assert.match(IMMUTABLE_CACHE_CONTROL, /immutable/)
  })
})

test('createRequestHandler', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'obiter-serve-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(
    join(dir, 'assets', 'app-12345678.js'),
    'export const x = 1\n',
  )
  const ssrHtml = '<!doctype html><html><body>hi</body></html>'
  const handler = createRequestHandler(
    () =>
      new Response(ssrHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    { clientDir: dir },
  )
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  try {
    await t.test('hashed assets are immutable and gzipped', async () => {
      const res = await fetch(`${origin}/assets/app-12345678.js`, {
        headers: { 'accept-encoding': 'gzip' },
      })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-encoding'), 'gzip')
      assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL)
      assert.match(res.headers.get('vary') ?? '', /Accept-Encoding/i)
      assert.equal(await res.text(), 'export const x = 1\n')
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
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
