import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'
import { resolveConfig } from 'vite'

/*
 * Integration regression for the dev server's API origin.
 *
 * The unit suite pins `resolveDevApiOrigin` in isolation. This suite drives the
 * real Vite configuration lifecycle, so it fails if the resolved origin stops
 * reaching either the `/api` proxy or the SSR `process.env.OBITER_API_ORIGIN`
 * define — the split that let a lane render against one backend and
 * authenticate against the shared one (P1.39).
 *
 * It also pins the two fail-closed paths the first review demonstrated:
 *
 * - shared-default eligibility is decided from the *effective* server port, so
 *   `vite dev --port 3098` on an unconfigured worktree is refused even though
 *   `OBITER_WEB_PORT` is absent; and
 * - a supplied but invalid or zero `OBITER_WEB_PORT` is refused instead of
 *   silently becoming the shared port 3000.
 *
 * No test contacts a server. Refusal is observed at config resolution, before
 * any listener or proxy target exists, and the only API origins named here are
 * synthetic loopback ports — never the real shared :8787.
 */

const CONFIG_FILE = fileURLToPath(new URL('./vite.config.ts', import.meta.url))

// The resolver reads the process environment before the worktree `.env`, and an
// empty string is "configured but blank", which the resolver treats as absent.
// That lets the suite neutralise any key a developer's checkout happens to set
// so the assertions do not depend on the machine it runs on.
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
  // `logLevel: silent` keeps Vite from printing the expected config-load
  // failures the refusal tests assert on.
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
  // `vite preview` copies `server.proxy` before `configResolved`; mutating it in
  // place is what keeps the preview `/api` route on the same origin.
  assert.equal(
    resolved.preview.proxy?.['/api']?.target,
    'http://localhost:9891',
  )
})

test('refuses an unconfigured server moved off the shared port by --port', async () => {
  // Vite merges `--port 3098` into the resolved server after the config
  // function has run. The config function still sees an absent OBITER_WEB_PORT
  // and its shared 3000 default, so only the effective port can catch this.
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
