import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  assertLaneTargets,
  commonDirectory,
  resolveLaneTargets,
  SHARED_API_PORT,
  SHARED_WEB_PORT,
  verifyServedCheckout,
  WORKTREE_ROOT,
} from './lane-target.mjs'
import { resolveLocalEnvFile } from '@obiter/config/local-env'

const tempDirs = []

after(async () => {
  await Promise.all(
    tempDirs.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

/**
 * A worktree-shaped directory: a bun.lock marker (which bounds the
 * .env walk) and optionally the lane .env the setup script writes.
 */
async function laneWorktree(env) {
  const root = await mkdtemp(join(tmpdir(), 'obiter-lane-'))
  tempDirs.push(root)
  await writeFile(join(root, 'bun.lock'), '// bun lockfile v1\n')
  if (env !== null) await writeFile(join(root, '.env'), env)
  return root
}

const LANE_ENV = 'OBITER_WEB_PORT=3004\nPORT=8791\n'
const SHA = 'a'.repeat(40)

test('defaults to the checkout that holds this suite', () => {
  // The default root is the worktree root, not apps/: resolving it one level
  // short makes every provenance check compare against the wrong directory.
  // Nothing here depends on a developer's .env, which CI does not have.
  assert.ok(existsSync(join(WORKTREE_ROOT, 'bun.lock')))
  assert.ok(existsSync(join(WORKTREE_ROOT, 'apps', 'web', 'lane-target.mjs')))

  const targets = resolveLaneTargets({ processEnv: {} })
  assert.equal(targets.envFile, resolveLocalEnvFile(WORKTREE_ROOT))
  assert.ok(
    targets.envFile === null || targets.envFile === join(WORKTREE_ROOT, '.env'),
  )
})

test('reads the lane ports from the worktree .env', async () => {
  const root = await laneWorktree(LANE_ENV)

  const targets = resolveLaneTargets({ startDirectory: root, processEnv: {} })

  assert.equal(targets.envFile, join(root, '.env'))
  assert.equal(targets.webPort, 3004)
  assert.equal(targets.apiPort, 8791)
  assert.equal(targets.webOrigin, 'http://localhost:3004')
  assert.equal(targets.apiOrigin, 'http://127.0.0.1:8791')
})

test('the process environment overrides the worktree .env', async () => {
  const root = await laneWorktree(LANE_ENV)

  const targets = resolveLaneTargets({
    startDirectory: root,
    processEnv: { OBITER_WEB_PORT: '3999', PORT: '8999' },
  })

  assert.equal(targets.webPort, 3999)
  assert.equal(targets.apiPort, 8999)
})

test('defaults to the shared ports only when nothing configures one', async () => {
  const root = await laneWorktree(null)

  const targets = resolveLaneTargets({ startDirectory: root, processEnv: {} })

  assert.equal(targets.envFile, null)
  assert.equal(targets.webPort, SHARED_WEB_PORT)
  assert.equal(targets.apiPort, SHARED_API_PORT)
})

test('refuses an unparseable port instead of falling back silently', async () => {
  const root = await laneWorktree('OBITER_WEB_PORT=30x4\n')

  assert.throws(
    () => resolveLaneTargets({ startDirectory: root, processEnv: {} }),
    /OBITER_WEB_PORT must be a decimal port/,
  )
  for (const value of ['0', '65536', '1e3']) {
    assert.throws(
      () =>
        resolveLaneTargets({
          startDirectory: root,
          processEnv: { PORT: value, OBITER_WEB_PORT: '3004' },
        }),
      /PORT must be a decimal port/,
      `PORT="${value}" should be refused`,
    )
  }
})

test('refuses the shared ports when an existing server may be reused', async () => {
  const root = await laneWorktree(null)
  const targets = resolveLaneTargets({ startDirectory: root, processEnv: {} })

  assert.throws(
    () => assertLaneTargets(targets, { reuseExistingServer: true }),
    /shared dev ports/,
  )
  // CI starts its own servers, so the defaults are that runner's own ports.
  assert.doesNotThrow(() =>
    assertLaneTargets(targets, { reuseExistingServer: false }),
  )
})

test('a lane-configured run passes the reuse guard', async () => {
  const root = await laneWorktree(LANE_ENV)
  const targets = resolveLaneTargets({ startDirectory: root, processEnv: {} })

  assert.doesNotThrow(() =>
    assertLaneTargets(targets, { reuseExistingServer: true }),
  )
})

/** A fake fetch standing in for the lane's web and API servers. */
function fakeServers({ root, webRoot = root, apiRoot = root, envFile }) {
  return async (url) => {
    if (url.endsWith('/api/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          service: 'obiter-api',
          provenance: { checkoutRoot: apiRoot, commitSha: SHA, envFile },
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        `/@fs${webRoot}/packages/app-shell/src/index.ts\n${webRoot}/apps/web/src/routes/__root.tsx\n`,
    }
  }
}

async function laneTargets() {
  const root = await laneWorktree(LANE_ENV)
  return {
    root,
    targets: resolveLaneTargets({ startDirectory: root, processEnv: {} }),
  }
}

test('accepts servers that serve this worktree', async () => {
  const { root, targets } = await laneTargets()

  const served = await verifyServedCheckout(targets, {
    worktreeRoot: root,
    fetchImpl: fakeServers({ root, envFile: join(root, '.env') }),
    headSha: SHA,
  })

  assert.equal(served.webRoot, root)
  assert.equal(served.apiRoot, root)
})

test('fails closed when the web server serves another checkout', async () => {
  const { root, targets } = await laneTargets()

  await assert.rejects(
    verifyServedCheckout(targets, {
      worktreeRoot: root,
      fetchImpl: fakeServers({
        root,
        webRoot: '/home/karl/Source/Obiter/obiter-live',
        envFile: join(root, '.env'),
      }),
    }),
    /serves \/home\/karl\/Source\/Obiter\/obiter-live, not this worktree/,
  )
})

test('fails closed when the API serves another checkout', async () => {
  const { root, targets } = await laneTargets()

  await assert.rejects(
    verifyServedCheckout(targets, {
      worktreeRoot: root,
      fetchImpl: fakeServers({
        root,
        apiRoot: '/home/karl/Source/Obiter/obiter-live',
        envFile: join(root, '.env'),
      }),
    }),
    /The API at .* serves \/home\/karl\/Source\/Obiter\/obiter-live/,
  )
})

test('fails closed when a reused API is a different commit', async () => {
  const { root, targets } = await laneTargets()

  await assert.rejects(
    verifyServedCheckout(targets, {
      worktreeRoot: root,
      fetchImpl: fakeServers({ root, envFile: join(root, '.env') }),
      headSha: 'b'.repeat(40),
    }),
    /is running a{40} but this worktree is at b{40}/,
  )
})

test('fails closed when the API resolved another worktree .env', async () => {
  const { root, targets } = await laneTargets()

  await assert.rejects(
    verifyServedCheckout(targets, {
      worktreeRoot: root,
      fetchImpl: fakeServers({
        root,
        envFile: '/home/karl/Source/Obiter/.env',
      }),
    }),
    /resolved its configuration from \/home\/karl\/Source\/Obiter\/\.env/,
  )
})

test('fails closed when a server cannot be attributed at all', async () => {
  const { root, targets } = await laneTargets()

  await assert.rejects(
    verifyServedCheckout(targets, {
      worktreeRoot: root,
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    /Could not determine which checkout/,
  )

  await assert.rejects(
    verifyServedCheckout(targets, {
      worktreeRoot: root,
      fetchImpl: async (url) =>
        url.endsWith('/api/health')
          ? { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
          : fakeServers({ root, envFile: join(root, '.env') })(url),
    }),
    /reported no development provenance/,
  )
})

test('commonDirectory is the shared parent of the embedded paths', () => {
  assert.equal(
    commonDirectory([
      '/w/lane/packages/app-shell/src/index.ts',
      '/w/lane/apps/web/src/routes/__root.tsx',
    ]),
    '/w/lane',
  )
  assert.equal(commonDirectory([]), null)
  assert.equal(
    commonDirectory(['/apps/web/src/routes/__root.tsx']),
    '/apps/web/src/routes',
  )
  assert.equal(commonDirectory(['/tmp/first.ts', '/other/second.ts']), null)
})
