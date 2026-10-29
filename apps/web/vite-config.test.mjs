import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'
import { resolveConfig } from 'vite'

const CONFIG_FILE = fileURLToPath(new URL('./vite.config.ts', import.meta.url))

const NEUTRALISED_KEYS = ['OBITER_API_ORIGIN', 'PORT', 'OBITER_WEB_PORT']
const savedEnv = new Map()

function setEnv(overrides) {
  for (const key of NEUTRALISED_KEYS) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
    process.env[key] = overrides[key] ?? ''
  }
}

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnv.clear()
})

async function resolveDevConfig({ env = {}, port } = {}) {
  setEnv(env)
  const inline = { configFile: CONFIG_FILE, logLevel: 'silent' }
  if (port !== undefined) inline.server = { port }
  return resolveConfig(inline, 'serve', 'development')
}

function definedOrigin(resolved) {
  const define = resolved.environments.ssr?.define
  assert.ok(define, 'the SSR environment must receive a define')
  const value = define['process.env.OBITER_API_ORIGIN']
  assert.ok(
    typeof value === 'string' && value.length > 0,
    'the SSR environment must define process.env.OBITER_API_ORIGIN',
  )
  return JSON.parse(value)
}

test('the proxy target and the SSR define carry the same origin', async () => {
  const resolved = await resolveDevConfig({
    env: { OBITER_API_ORIGIN: 'http://localhost:9891' },
    port: 3002,
  })

  assert.equal(resolved.server.proxy['/api'].target, 'http://localhost:9891')
  assert.equal(definedOrigin(resolved), 'http://localhost:9891')
  assert.equal(
    resolved.preview.proxy?.['/api']?.target,
    'http://localhost:9891',
  )
})

test('refuses an unconfigured server moved off the shared port by --port', async () => {
  await assert.rejects(
    resolveDevConfig({ port: 3098 }),
    /must not fall back to the shared dev API/,
  )
})

test('refuses invalid and zero OBITER_WEB_PORT values', async () => {
  for (const value of ['oops', '0', '65536', '1e3', '87x9']) {
    await assert.rejects(
      resolveDevConfig({ env: { OBITER_WEB_PORT: value } }),
      /OBITER_WEB_PORT must be a decimal port/,
      `OBITER_WEB_PORT="${value}" should be refused`,
    )
  }
})

test('accepts a lane that names its own origin and port', async () => {
  const resolved = await resolveDevConfig({
    env: {
      OBITER_API_ORIGIN: 'http://localhost:9891',
      OBITER_WEB_PORT: '3002',
    },
  })

  assert.equal(resolved.server.port, 3002)
  assert.equal(resolved.server.proxy['/api'].target, 'http://localhost:9891')
  assert.equal(definedOrigin(resolved), 'http://localhost:9891')
})

test('derives the lane origin from PORT when no origin is named', async () => {
  const resolved = await resolveDevConfig({
    env: { PORT: '8791', OBITER_WEB_PORT: '3004' },
  })

  assert.equal(resolved.server.port, 3004)
  assert.equal(resolved.server.proxy['/api'].target, 'http://localhost:8791')
  assert.equal(definedOrigin(resolved), 'http://localhost:8791')
})

test('keeps the shared dev default on the shared web port', async () => {
  const resolved = await resolveDevConfig({ port: 3000 })

  assert.equal(resolved.server.port, 3000)
  assert.equal(resolved.server.proxy['/api'].target, 'http://localhost:8787')
  assert.equal(definedOrigin(resolved), 'http://localhost:8787')
})
