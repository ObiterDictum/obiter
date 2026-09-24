/*
 * Regression tests for the journey's API-origin and database isolation.
 *
 * The reviewed head (`540d654`) let `journey.spec.ts` fall back to the shared
 * dev API on `127.0.0.1:8787` when `OBITER_API_ORIGIN` was unset: sign-up then
 * created the synthetic user in the shared `obiter` database while the psql
 * verification updated the task database, sign-in failed, and shared data was
 * written to. The source assertions below fail against that head; the
 * resolver assertions below prove the shared endpoint can no longer be reached
 * by the journey in any configuration, so a run that cannot name an isolated
 * stack aborts before an account exists.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { resolveJourneyTargets } from './journey-target.mjs'

const tempDirs = []

after(async () => {
  await Promise.all(
    tempDirs.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

/** A worktree-shaped directory with no `.env`, so only processEnv configures. */
async function bareWorktree() {
  const root = await mkdtemp(join(tmpdir(), 'obiter-journey-'))
  tempDirs.push(root)
  await writeFile(join(root, 'bun.lock'), '// bun lockfile v1\n')
  return root
}

const TASK_DB_URL = 'postgresql://obiter:obiter@127.0.0.1:5432/obiter_e2e_task'
const LANE_ENV = {
  PORT: '8789',
  OBITER_WEB_PORT: '3002',
  OBITER_E2E_DATABASE_URL: TASK_DB_URL,
}

test('the journey spec cannot name or reach the shared 8787 endpoint', async () => {
  const spec = await readFile(
    new URL('e2e/journey.spec.ts', import.meta.url),
    'utf8',
  )

  // The reviewed head carried `?? 'http://127.0.0.1:8787'` on line 6; this
  // fails there and keeps it from coming back in any form.
  assert.ok(
    !spec.includes('8787'),
    'journey.spec.ts must not name the shared dev API port',
  )
  assert.ok(
    !spec.includes('OBITER_API_ORIGIN'),
    'journey.spec.ts must take its origin from the guard, not raw env',
  )
  assert.ok(
    spec.includes('resolveJourneyTargets()'),
    'journey.spec.ts must resolve its targets through journey-target',
  )

  // The guard runs at module load — before the test registers and before any
  // request — so a refused configuration cannot create an account first.
  const guardAt = spec.indexOf('resolveJourneyTargets()')
  assert.ok(guardAt !== -1)
  assert.ok(
    guardAt < spec.indexOf("test('sign in"),
    'the guard must resolve before the journey test is registered',
  )
  assert.ok(
    guardAt < spec.indexOf('request.post('),
    'the guard must resolve before any request is made',
  )
  assert.ok(
    guardAt < spec.indexOf('execFileSync('),
    'the guard must resolve before any database is touched',
  )
})

test('refuses the shared API the resolver would otherwise default to', async () => {
  const startDirectory = await bareWorktree()

  // Nothing selects a port anywhere: this is the exact reviewed-head
  // configuration, and it must throw instead of signing up on 8787.
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: { OBITER_E2E_DATABASE_URL: TASK_DB_URL },
      }),
    /shared dev stack \(port 8787\)/,
  )
})

test('refuses an explicitly shared origin even on lane ports', async () => {
  const startDirectory = await bareWorktree()

  for (const origin of [
    'http://127.0.0.1:8787',
    'http://localhost:8787/',
    'http://127.0.0.1:3000', // the shared web server proxies /api to the shared API
  ]) {
    assert.throws(
      () =>
        resolveJourneyTargets({
          startDirectory,
          processEnv: { ...LANE_ENV, OBITER_API_ORIGIN: origin },
        }),
      /shared dev stack/,
      `${origin} should be refused`,
    )
  }
})

test('refuses shared server ports behind an otherwise clean origin', async () => {
  const startDirectory = await bareWorktree()

  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: {
          ...LANE_ENV,
          // A clean origin with a shared PORT still means the API server would
          // be started on obiter-live's port.
          OBITER_API_ORIGIN: 'http://127.0.0.1:8789',
          PORT: '8787',
        },
      }),
    /shared API port 8787/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: { ...LANE_ENV, OBITER_WEB_PORT: '3000' },
      }),
    /shared web port 3000/,
  )
})

test('refuses an origin that is absent, unparseable or not http', async () => {
  const startDirectory = await bareWorktree()

  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: { ...LANE_ENV, OBITER_API_ORIGIN: '' },
      }),
    /No API origin/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: { ...LANE_ENV, OBITER_API_ORIGIN: 'not-a-url' },
      }),
    /not a valid URL/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: { ...LANE_ENV, OBITER_API_ORIGIN: 'ftp://127.0.0.1:8789' },
      }),
    /not an http\(s\) origin/,
  )
})

test('refuses a non-loopback origin that could be a shared deployment', async () => {
  const startDirectory = await bareWorktree()

  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: {
          ...LANE_ENV,
          OBITER_API_ORIGIN: 'http://10.20.30.40:8789',
        },
      }),
    /not a loopback address/,
  )
})

test('requires the verification database to be explicitly selected', async () => {
  const startDirectory = await bareWorktree()
  const { OBITER_E2E_DATABASE_URL: _omitted, ...withoutDb } = LANE_ENV

  assert.throws(
    () => resolveJourneyTargets({ startDirectory, processEnv: withoutDb }),
    /OBITER_E2E_DATABASE_URL is not set/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: {
          ...LANE_ENV,
          OBITER_E2E_DATABASE_URL:
            'postgresql://obiter:obiter@127.0.0.1:5432/obiter',
        },
      }),
    /shared dev database/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: {
          ...LANE_ENV,
          OBITER_E2E_DATABASE_URL: 'postgresql://obiter:obiter@127.0.0.1:5432/',
        },
      }),
    /names no database/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: { ...LANE_ENV, OBITER_E2E_DATABASE_NAME: 'obiter_other' },
      }),
    /does not name the database/,
  )
  assert.throws(
    () =>
      resolveJourneyTargets({
        startDirectory,
        processEnv: {
          ...LANE_ENV,
          OBITER_E2E_DATABASE_URL:
            'mysql://user:pass@127.0.0.1/obiter_e2e_task',
        },
      }),
    /must be a postgres URL/,
  )
})

test('accepts the explicitly selected, isolated lane configuration', async () => {
  const startDirectory = await bareWorktree()

  // Origin derived from the lane PORT, database name derived from the URL the
  // API server is started with: one API, one database, no fallbacks.
  assert.deepEqual(
    resolveJourneyTargets({ startDirectory, processEnv: LANE_ENV }),
    {
      apiOrigin: 'http://127.0.0.1:8789',
      webOrigin: 'http://localhost:3002',
      databaseName: 'obiter_e2e_task',
    },
  )

  // The same, selected through a worktree .env instead of the environment.
  const root = await mkdtemp(join(tmpdir(), 'obiter-journey-env-'))
  tempDirs.push(root)
  await writeFile(join(root, 'bun.lock'), '// bun lockfile v1\n')
  await writeFile(
    join(root, '.env'),
    'OBITER_WEB_PORT=3003\nPORT=8790\nOBITER_API_ORIGIN=http://localhost:8790\n',
  )
  assert.deepEqual(
    resolveJourneyTargets({
      startDirectory: root,
      processEnv: { OBITER_E2E_DATABASE_URL: TASK_DB_URL },
    }),
    {
      apiOrigin: 'http://localhost:8790',
      webOrigin: 'http://localhost:3003',
      databaseName: 'obiter_e2e_task',
    },
  )
})
