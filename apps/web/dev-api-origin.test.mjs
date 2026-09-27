import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyDevServerApiOrigin,
  resolveDevApiOrigin,
} from './dev-api-origin.mjs'

/*
 * These pin the contract that made SSR and the proxy disagree: the origin comes
 * from the process environment first and the worktree `.env` second, a lane
 * `.env` is honoured without exporting anything, and an unconfigured lane is
 * refused rather than pointed at the shared dev API.
 */

const SHARED_WEB_PORT = 3000
const SHARED_API_ORIGIN = 'http://localhost:8787'

test('honours a lane .env origin with no process environment override', () => {
  const origin = resolveDevApiOrigin({
    processEnv: {},
    fileEnv: { OBITER_API_ORIGIN: 'http://localhost:8789' },
    webPort: 3002,
  })

  assert.equal(origin, 'http://localhost:8789')
})

test('normalises a trailing slash and path on the configured origin', () => {
  assert.equal(
    resolveDevApiOrigin({
      processEnv: {},
      fileEnv: { OBITER_API_ORIGIN: 'http://localhost:8789/' },
      webPort: 3002,
    }),
    'http://localhost:8789',
  )
})

test('the process environment overrides the worktree .env', () => {
  const origin = resolveDevApiOrigin({
    processEnv: { OBITER_API_ORIGIN: 'http://localhost:9999' },
    fileEnv: { OBITER_API_ORIGIN: 'http://localhost:8789' },
    webPort: 3002,
  })

  assert.equal(origin, 'http://localhost:9999')
})

test('OBITER_API_ORIGIN takes precedence over PORT', () => {
  const origin = resolveDevApiOrigin({
    processEnv: {},
    fileEnv: { OBITER_API_ORIGIN: 'http://localhost:8789', PORT: '9999' },
    webPort: 3002,
  })

  assert.equal(origin, 'http://localhost:8789')
})

test('derives the lane API origin from PORT when no origin is configured', () => {
  const origin = resolveDevApiOrigin({
    processEnv: {},
    fileEnv: { PORT: '8791' },
    webPort: 3004,
  })

  assert.equal(origin, 'http://localhost:8791')
})

test('refuses an unconfigured non-shared dev server instead of the shared API', () => {
  assert.throws(
    () =>
      resolveDevApiOrigin({
        processEnv: {},
        fileEnv: {},
        webPort: 3004,
      }),
    /must not fall back to the shared dev API/,
  )
})

test('keeps the shared dev default only for the shared web server', () => {
  const origin = resolveDevApiOrigin({
    processEnv: {},
    fileEnv: {},
    webPort: SHARED_WEB_PORT,
  })

  assert.equal(origin, SHARED_API_ORIGIN)
})

test('a blank origin falls through to PORT rather than to the shared API', () => {
  const origin = resolveDevApiOrigin({
    processEnv: { OBITER_API_ORIGIN: '' },
    fileEnv: { PORT: '8789' },
    webPort: 3002,
  })

  assert.equal(origin, 'http://localhost:8789')
})

test('refuses an invalid configured origin', () => {
  for (const value of ['not-a-url', 'ftp://localhost:8789', 'localhost:8789']) {
    assert.throws(
      () =>
        resolveDevApiOrigin({
          processEnv: {},
          fileEnv: { OBITER_API_ORIGIN: value },
          webPort: 3002,
        }),
      /OBITER_API_ORIGIN/,
      `OBITER_API_ORIGIN="${value}" should be refused`,
    )
  }
})

test('refuses an invalid PORT', () => {
  for (const value of ['0', '65536', '1e3', '87x9']) {
    assert.throws(
      () =>
        resolveDevApiOrigin({
          processEnv: {},
          fileEnv: { PORT: value },
          webPort: 3002,
        }),
      /PORT must be a decimal port/,
      `PORT="${value}" should be refused`,
    )
  }
})

test('does not echo credentials from a malformed origin', () => {
  let message = ''
  try {
    resolveDevApiOrigin({
      processEnv: {},
      fileEnv: { OBITER_API_ORIGIN: 'http://user:s3cr3t@' },
      webPort: 3002,
    })
  } catch (error) {
    message = error.message
  }

  assert.match(message, /OBITER_API_ORIGIN/)
  assert.ok(!message.includes('s3cr3t'), 'the credential must not be echoed')
  assert.match(message, /<redacted>/)
})

test('does not echo credentials from a non-http(s) origin', () => {
  let message = ''
  try {
    resolveDevApiOrigin({
      processEnv: {},
      fileEnv: { OBITER_API_ORIGIN: 'ftp://user:s3cr3t@localhost:8789' },
      webPort: 3002,
    })
  } catch (error) {
    message = error.message
  }

  assert.ok(!message.includes('s3cr3t'), 'the credential must not be echoed')
  assert.match(message, /ftp:\/\/localhost:8789/)
})

test('refusal leaves no proxy target or SSR define wired', () => {
  const config = {
    server: { port: 3098, proxy: {} },
    environments: { ssr: {} },
  }

  assert.throws(
    () => applyDevServerApiOrigin(config, { processEnv: {}, fileEnv: {} }),
    /must not fall back to the shared dev API/,
  )
  // The shared target must not be installed before the refusal; a failed
  // resolution must not leave a proxy or define pointing at 8787.
  assert.equal(config.server.proxy['/api'], undefined)
  assert.equal(config.environments.ssr.define, undefined)
})

test('re-resolves on a config restart without writing the process environment', () => {
  const processEnv = {}

  const first = { server: { port: 3002, proxy: {} }, environments: { ssr: {} } }
  applyDevServerApiOrigin(first, {
    processEnv,
    fileEnv: { OBITER_API_ORIGIN: 'http://localhost:9891' },
  })
  assert.equal(first.server.proxy['/api'].target, 'http://localhost:9891')

  // Vite re-evaluates the config on restart. A value the resolver wrote into
  // process.env would shadow the edited .env and pin the first origin; the
  // resolver must not write one.
  const second = { server: { port: 3002, proxy: {} }, environments: { ssr: {} } }
  applyDevServerApiOrigin(second, {
    processEnv,
    fileEnv: { OBITER_API_ORIGIN: 'http://localhost:9892' },
  })
  assert.equal(second.server.proxy['/api'].target, 'http://localhost:9892')
  assert.equal(processEnv.OBITER_API_ORIGIN, undefined)
})
