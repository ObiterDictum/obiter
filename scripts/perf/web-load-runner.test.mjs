/*
 * Process-cleanup regressions for the page-load runner.
 *
 * The rule under test is that the runner owns the `serve.mjs` it spawns: on a
 * preflight failure, a journey failure, a normal exit or an interrupt, the
 * listener must be gone and the port reusable — while a listener the runner did
 * not spawn is never touched. A "kill was called" assertion would not prove
 * that, so every case checks the actual port.
 *
 * The SSR child here is a stub `serve.mjs` that serves the marker on disk and
 * the sign-in copy `assertWebRenders` needs; the runner's real serve.mjs is
 * covered by apps/web/serve.test.mjs. No Chromium is launched: the failing
 * cases stop before a browser, and the success path is exercised through the
 * runner's own `withTarget` lifecycle.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import net from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, test } from 'bun:test'
import { withTarget } from './web-load-runner.mjs'
import { writeBuildProvenance } from '../../apps/web/build-provenance.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const COMMIT = 'a'.repeat(40)
const WRONG_COMMIT = 'b'.repeat(40)

const tempDirs = []
const openServers = []
const openChildren = []

afterAll(async () => {
  for (const child of openChildren) child.kill('SIGKILL')
  await Promise.all(
    openServers.map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections?.()
          server.close(resolve)
        }),
    ),
  )
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

// Serves the build marker the runner cross-checks against disk (read from the
// cwd the runner sets) and the sign-in copy `assertWebRenders` requires.
const STUB_SERVE = `
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const marker = join(process.cwd(), 'dist', '.obiter-build.json')
const server = createServer((req, res) => {
  if (req.url === '/.well-known/obiter-build') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(readFileSync(marker))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><p>Sign in to Obiter</p>')
})
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1')
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
`

/** A worktree-shaped fixture with a real build marker written into dist. */
async function makeFixture({ commit = COMMIT, dirty = '0' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'obiter-runner-'))
  tempDirs.push(dir)
  const web = join(dir, 'apps', 'web')
  await mkdir(join(web, 'dist', 'client', 'assets'), { recursive: true })
  await mkdir(join(web, 'dist', 'server'), { recursive: true })
  await writeFile(
    join(web, 'dist', 'client', 'assets', 'index-abcdefgh.js'),
    'export const x = 1\n',
  )
  await writeFile(
    join(web, 'dist', 'server', 'server.js'),
    'export default { fetch() {} }\n',
  )
  await writeFile(join(web, 'serve.mjs'), STUB_SERVE)

  // writeBuildProvenance prefers the environment; set it for determinism and
  // restore it so a test never leaks identity into the next one.
  const saved = {
    commit: process.env.OBITER_BUILD_COMMIT,
    dirty: process.env.OBITER_BUILD_DIRTY,
  }
  process.env.OBITER_BUILD_COMMIT = commit
  process.env.OBITER_BUILD_DIRTY = dirty
  try {
    await writeBuildProvenance(join(web, 'dist'), { repoRoot: dir })
  } finally {
    if (saved.commit === undefined) delete process.env.OBITER_BUILD_COMMIT
    else process.env.OBITER_BUILD_COMMIT = saved.commit
    if (saved.dirty === undefined) delete process.env.OBITER_BUILD_DIRTY
    else process.env.OBITER_BUILD_DIRTY = saved.dirty
  }
  return dir
}

/** A stand-in API whose /api/health names a provenance. Returns its port. */
async function startApiStub() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        provenance: { checkoutRoot: '/fixture', commitSha: COMMIT },
      }),
    )
  })
  openServers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

/** Bind :0 to learn a free port, then release it for the runner to own. */
async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForListening(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isListening(port)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`nothing listened on ${port} within ${timeoutMs}ms`)
}

async function serveConfig(dir, { ssrPort, webPort, apiPort, expected }) {
  return {
    serveProd: dir,
    webUrl: `http://127.0.0.1:${webPort}`,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    expectArtifactCommit: expected ?? COMMIT,
    ssrPort,
  }
}

/** A fresh fixture, API stub and two free ports, for one scenario. */
async function scenario({ expected, commit, dirty } = {}) {
  const dir = await makeFixture({ commit, dirty })
  const apiPort = await startApiStub()
  const ssrPort = await freePort()
  const webPort = await freePort()
  return {
    dir,
    ssrPort,
    config: await serveConfig(dir, { ssrPort, webPort, apiPort, expected }),
  }
}

function runRunner(args) {
  const child = spawn(
    process.execPath,
    ['scripts/perf/web-load-runner.mjs', ...args],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  )
  openChildren.push(child)
  return child
}

function waitForExit(child) {
  return new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
}

test('a successful preflight releases the port and the next run can reuse it', async () => {
  const { ssrPort, config } = await scenario()
  const first = await withTarget(config)
  assert.equal(first.identity.artifact.verified, true)
  assert.equal(await isListening(ssrPort), true)
  await first.stop()
  assert.equal(await isListening(ssrPort), false)

  const second = await withTarget(config)
  assert.equal(await isListening(ssrPort), true)
  await second.stop()
  assert.equal(await isListening(ssrPort), false)
}, 30_000)

test('a wrong expected artifact commit stops the server it spawned', async () => {
  const { ssrPort, config } = await scenario({ expected: WRONG_COMMIT })
  await assert.rejects(
    () => withTarget(config),
    /artifact commit is a{40}, expected b{40}/,
  )
  assert.equal(await isListening(ssrPort), false)
}, 30_000)

test('a dist that fails provenance after the spawn is stopped', async () => {
  const { dir, ssrPort, config } = await scenario()
  await writeFile(
    join(dir, 'apps', 'web', 'dist', 'client', 'assets', 'index-abcdefgh.js'),
    'tampered\n',
  )
  await assert.rejects(() => withTarget(config), /modified after build/)
  assert.equal(await isListening(ssrPort), false)
}, 30_000)

test('an occupied SSR port is refused and the unrelated listener stays alive', async () => {
  const { config, ssrPort } = await scenario()
  const unrelated = createServer((_req, res) => res.end('unrelated'))
  openServers.push(unrelated)
  await new Promise((resolve) =>
    unrelated.listen(ssrPort, '127.0.0.1', resolve),
  )
  await assert.rejects(() => withTarget(config), /already in use/)
  assert.equal(await isListening(ssrPort), true)
}, 30_000)

test('a journey that cannot run exits nonzero and leaves no listener', async () => {
  const { dir, ssrPort, config } = await scenario()
  const child = runRunner([
    '--serve-prod',
    dir,
    '--expect-artifact-commit',
    COMMIT,
    '--web-url',
    config.webUrl,
    '--api-url',
    config.apiUrl,
    '--ssr-port',
    String(ssrPort),
    // No --fixtures: matterId is unset, so the journey fails before a browser.
    '--journeys',
    'matter-detail',
    '--samples',
    '1',
  ])
  const { code } = await waitForExit(child)
  assert.equal(code, 1)
  assert.equal(await isListening(ssrPort), false)
}, 30_000)

test('SIGTERM stops the owned server and frees the port', async () => {
  const { dir, ssrPort, config } = await scenario()
  const child = runRunner([
    '--serve-prod',
    dir,
    '--expect-artifact-commit',
    COMMIT,
    '--web-url',
    config.webUrl,
    '--api-url',
    config.apiUrl,
    '--ssr-port',
    String(ssrPort),
    '--journeys',
    'sign-in',
    '--samples',
    '1',
  ])
  await waitForListening(ssrPort)
  child.kill('SIGTERM')
  const { code } = await waitForExit(child)
  assert.equal(code, 143)
  assert.equal(await isListening(ssrPort), false)
}, 30_000)
