#!/usr/bin/env node
/*
 * Task-owned end-to-end proof that ambient PGPORT cannot move the API child or
 * the psql fixtures off the validated target.
 *
 * Two controlled loopback listeners stand in for two clusters: `intended` and
 * `wrong`. The guard resolves a target that names the intended listener's
 * port, and ambient PGPORT names the wrong one. The proof then runs
 *
 *   - the real psql querier (scripts/load/psql.mjs) against `target.url`, and
 *   - the real Node API child through the harness's own `startServer` and
 *     `childEnvironment`,
 *
 * and asserts both dialled `intended` at least once and `wrong` never. It
 * touches no real Postgres: the listeners accept and close, so the consumers
 * error early and the proof is about which socket they opened, not what they
 * got back.
 *
 * When port 5432 is free the intended listener takes it and the target is
 * passed as a *portless* URL, which is the exact shape of the reproduced defect.
 * When 5432 is occupied (for example a CI Postgres service) the intended
 * listener takes an ephemeral port and the URL carries it explicitly.
 *
 * This is the manual evidence companion to the fail-first regressions in
 * database-target.test.mjs. Run it with:
 *
 *   node scripts/api-runtime/database-target-proof.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQuerier } from '../load/psql.mjs'
import { WORKTREE_ROOT, childEnvironment } from './config.mjs'
import { resolveDatabaseTarget } from './database-target.mjs'
import { allocatePort, startServer } from './lifecycle.mjs'

function startRecorder(port = 0) {
  const connections = []
  const server = createServer((socket) => {
    connections.push(socket.remotePort)
    socket.destroy()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        connections,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, { timeoutMs = 60_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(intervalMs)
  }
  return false
}

async function main() {
  let intended
  try {
    intended = await startRecorder(5432)
  } catch {
    intended = await startRecorder(0)
  }
  const wrong = await startRecorder(0)
  const scratch = await mkdtemp(join(tmpdir(), 'obiter-target-proof-'))

  // Pass the portless form when the intended listener owns the default port:
  // that is the URL the reviewer reproduced the defect with.
  const portSegment = intended.port === 5432 ? '' : `:${intended.port}`
  const target = resolveDatabaseTarget({
    databaseUrl:
      `postgres://obiter:obiter@127.0.0.1${portSegment}` +
      '/obiter_api_runtime_test',
  })

  // A conflicting ambient environment, exactly what a shell or a lane .env
  // could leave behind. Every one of these names a different target.
  Object.assign(process.env, {
    PGHOST: 'wrong.internal',
    PGPORT: String(wrong.port),
    PGUSER: 'wrong',
    PGPASSWORD: 'wrong',
    PGDATABASE: 'wrong',
    PGSERVICE: 'wrong-service',
  })

  const results = []
  let server = null
  try {
    // psql: the fixtures path. execFileSync blocks this event loop, so the
    // listener's connection event is delivered only after it returns; wait for
    // it before reading the counter.
    try {
      createQuerier({ databaseUrl: target.url }).exec('select 1')
    } catch {
      // The listener closes before the handshake completes. The connection is
      // the evidence; the failure is expected.
    }
    results.push([
      'psql',
      await waitFor(() => intended.connections.length > 0, {
        timeoutMs: 5_000,
      }),
    ])
    const afterPsql = intended.connections.length

    // The real API child, composed the way the harness composes it.
    const port = await allocatePort()
    server = startServer({
      runtime: 'node',
      worktreeRoot: WORKTREE_ROOT,
      port,
      environment: childEnvironment({
        port,
        target,
        storageRoot: join(scratch, 'storage'),
      }),
    })
    results.push([
      'api child',
      await waitFor(
        () =>
          intended.connections.length > afterPsql ||
          server.child.exitCode !== null ||
          server.child.signalCode !== null,
      ),
    ])
  } finally {
    if (server && server.child.exitCode === null) server.child.kill('SIGKILL')
    await Promise.all([intended.close(), wrong.close()])
    await rm(scratch, { recursive: true, force: true })
  }

  const intendedHits = intended.connections.length
  const wrongHits = wrong.connections.length
  for (const [label, ok] of results) {
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${label} dialled the validated target only`,
    )
  }
  console.log(
    `intended ${target.host}:${target.port} connections=${intendedHits}`,
  )
  console.log(
    `wrong 127.0.0.1:${wrong.port} (ambient PGPORT) connections=${wrongHits}`,
  )

  const failed =
    results.some(([, ok]) => !ok) || wrongHits !== 0 || intendedHits < 2
  if (failed) {
    console.error(
      'FAILED: ambient PGPORT moved a consumer off the validated target',
    )
    process.exitCode = 1
    return
  }
  console.log(
    `PASS ambient PGPORT=${wrong.port} could not move the API child or psql off ${target.host}:${target.port}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
