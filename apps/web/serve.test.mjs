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
import {
  DEFAULT_PORT,
  parsePort,
  resolveBaseUrl,
  applyResponseHeaders,
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
