/*
 * The database-target guard for the API runtime harness.
 *
 * The harness boots the real API, and the API applies migrations to whatever
 * DATABASE_URL names at boot. A guard that accepts a lane's *development*
 * database is therefore a guard that migrates it, which is what happened on
 * `obiter_lane_security` before this was written. These tests prove the refusal
 * happens before any connection, process spawn or fixture write, that a plain
 * name is not proof a host is ours, and that the URL the guard validates is the
 * URL the launched API receives.
 *
 * The last test runs the real entry point with the process-spawning commands
 * (bun, node, psql, python3, git) replaced by canaries, so a rejected target
 * provably reaches none of them. The accepted-target control proves the canary
 * fires when the run does proceed, so the negative result is not vacuous.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { childEnvironment, parseArgs } from './config.mjs'
import { resolveDatabaseTarget } from './database-target.mjs'

const WORKTREE_ROOT = join(import.meta.dir, '..', '..')
const databaseUrl = (name) => `postgres://obiter:obiter@localhost:5432/${name}`

// Process-spawning commands replaced by canaries, so a rejected target can be
// shown to reach none of them. Placed outside the suite because a `describe`
// body is not async.
const canaryScratch = await mkdtemp(join(tmpdir(), 'obiter-runtime-canary-'))
const canary = join(canaryScratch, 'spawned.log')
for (const command of ['bun', 'node', 'psql', 'python3', 'git']) {
  await writeFile(
    join(canaryScratch, command),
    `#!/bin/sh\necho "${command}" >> "${canary}"\nexit 0\n`,
    { mode: 0o755 },
  )
}
afterAll(() => rm(canaryScratch, { recursive: true, force: true }))

function refusal(input) {
  try {
    resolveDatabaseTarget(input)
  } catch (error) {
    return error
  }
  throw new Error(`expected a refusal for ${JSON.stringify(input)}`)
}

describe('refused targets', () => {
  it.each([
    ['a missing value', undefined, 'database_url_missing'],
    ['an empty value', '', 'database_url_missing'],
    ['whitespace', '   ', 'database_url_missing'],
    ['an unparseable URL', 'not a url', 'database_url_unparseable'],
    [
      'a URL with no database',
      'postgres://obiter:obiter@localhost:5432/',
      'database_name_missing',
    ],
    ['a URL with no host', 'postgres:///obiter_test', 'database_not_loopback'],
    [
      'a non-postgres scheme',
      'mysql://obiter:obiter@localhost:5432/obiter_test',
      'database_url_protocol',
    ],
    [
      'a remote host',
      'postgres://obiter:obiter@db.internal:5432/obiter_test',
      'database_not_loopback',
    ],
    // A name is not proof of a loopback host: the query can move the driver.
    [
      'a host query override',
      `${databaseUrl('obiter_test')}?host=db.internal`,
      'database_url_query_override',
    ],
    [
      'a database query override',
      `${databaseUrl('obiter_test')}?dbname=obiter_lane_security`,
      'database_url_query_override',
    ],
    [
      'a service query override',
      `${databaseUrl('obiter_test')}?service=other`,
      'database_url_query_override',
    ],
    [
      'a database query with no path database',
      'postgres://obiter:obiter@localhost:5432/?dbname=obiter_test',
      'database_url_query_override',
    ],
    // psql reads the pathname literally; the API driver decodes it.
    [
      'a percent-encoded name',
      databaseUrl('obiter%5Flane%5Fsecurity'),
      'database_name_encoded',
    ],
    ['an encoded slash', databaseUrl('obiter%2Ftest'), 'database_name_encoded'],
    [
      'malformed percent-encoding',
      databaseUrl('obiter%'),
      'database_name_encoded',
    ],
    [
      'a path with more than a database',
      databaseUrl('obiter_test/extra'),
      'database_name_invalid',
    ],
    // Shared, cluster and lane development databases are never targets.
    [
      'the shared product database',
      databaseUrl('obiter'),
      'database_protected',
    ],
    [
      'the shared corpus database',
      databaseUrl('obiter_corpus'),
      'database_protected',
    ],
    ['the cluster database', databaseUrl('postgres'), 'database_protected'],
    ['a template database', databaseUrl('template0'), 'database_protected'],
    [
      'a lane development database',
      databaseUrl('obiter_lane_security'),
      'database_protected',
    ],
    [
      'a lane development database with a suffix-like name',
      databaseUrl('obiter_lane_verifyfix'),
      'database_protected',
    ],
    [
      'an arbitrary database',
      databaseUrl('someone_elses_dev'),
      'database_not_owned',
    ],
  ])('refuses %s', (_label, url, code) => {
    expect(refusal({ databaseUrl: url }).code).toBe(code)
  })

  it('never echoes the URL or its credentials in a refusal', () => {
    const error = refusal({
      databaseUrl:
        'postgres://obiter:s3cret@db.internal:5432/obiter_lane_security',
    })
    expect(error.message).not.toContain('s3cret')
    expect(error.message).not.toContain('db.internal:5432/obiter_lane_security')
  })
})

describe('accepted targets', () => {
  it.each([
    'obiter_test',
    'obiter_api_runtime',
    'obiter_api_runtime_test',
    'obiter_api_ingress',
    'obiter_api_ingress_test',
    'obiter_lane_security_test',
    'obiter_lane_search_test',
  ])('accepts %s and returns the URL the API must receive', (name) => {
    const url = databaseUrl(name)
    expect(resolveDatabaseTarget({ databaseUrl: url })).toEqual({
      name,
      url,
    })
  })

  it('accepts an unrelated query parameter that cannot move the target', () => {
    expect(
      resolveDatabaseTarget({
        databaseUrl: `${databaseUrl('obiter_test')}?sslmode=require`,
      }).name,
    ).toBe('obiter_test')
  })

  it('accepts an IPv6 loopback host', () => {
    expect(
      resolveDatabaseTarget({
        databaseUrl: 'postgres://obiter:obiter@[::1]:5432/obiter_test',
      }).name,
    ).toBe('obiter_test')
  })
})

describe('the --allow-database override', () => {
  it('admits a deliberate non-owned database only when it is named exactly', () => {
    expect(
      resolveDatabaseTarget({
        databaseUrl: databaseUrl('other_test'),
        allowDatabase: 'other_test',
      }).name,
    ).toBe('other_test')
    expect(
      refusal({
        databaseUrl: databaseUrl('other_test'),
        allowDatabase: 'different_test',
      }).code,
    ).toBe('database_not_owned')
  })

  it.each(['obiter', 'obiter_corpus', 'postgres', 'obiter_lane_security'])(
    'cannot override protection for %s',
    (name) => {
      expect(
        refusal({ databaseUrl: databaseUrl(name), allowDatabase: name }).code,
      ).toBe('database_protected')
    },
  )

  it('refuses a malformed override rather than ignoring it', () => {
    expect(
      refusal({
        databaseUrl: databaseUrl('obiter_test'),
        allowDatabase: 'not a name',
      }).code,
    ).toBe('allow_database_invalid')
  })
})

describe('argument parsing and launch propagation', () => {
  it('requires --database-url instead of falling back to the environment', () => {
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = databaseUrl('obiter_lane_security')
    try {
      for (const argv of [[], ['--runtime', 'node'], ['--database-url']]) {
        expect(() => parseArgs(argv)).toThrow(/--database-url is required/)
      }
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }
  })

  it('refuses an unknown flag', () => {
    expect(() => parseArgs(['--database-url=x', '--wat'])).toThrow(
      /Unknown argument "--wat"/,
    )
  })

  it('gives the launched API the validated URL, not an ambient one', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: databaseUrl('obiter_api_runtime_test'),
    })
    // startServer merges `{ ...process.env, ...environment }`, so reproduce it
    // with a conflicting ambient DATABASE_URL to prove the validated target wins.
    const ambientEnv = { DATABASE_URL: databaseUrl('obiter_lane_security') }
    const child = {
      ...ambientEnv,
      ...childEnvironment({
        port: 43210,
        databaseUrl: target.url,
        storageRoot: '/tmp/obiter-api-runtime-test-storage',
      }),
    }
    expect(child.DATABASE_URL).toBe(target.url)
    // The compatibility corpus mode must not inherit an ambient corpus URL.
    expect(child.CORPUS_DATABASE_URL).toBe('')
    expect(child.CORPUS_WRITE_DATABASE_URL).toBe('')
  })
})

describe('refusal happens before any process, connection or mutation', () => {
  beforeEach(async () => {
    await rm(canary, { force: true })
  })

  function runHarness(args) {
    return spawnSync(
      process.execPath,
      [
        join(
          WORKTREE_ROOT,
          'scripts',
          'api-runtime',
          'runtime-integration.mjs',
        ),
        ...args,
      ],
      {
        cwd: WORKTREE_ROOT,
        // Contain the child's own mkdtemp scratch in this suite's directory, so
        // a control run that fails after validation does not leak one.
        env: {
          PATH: canaryScratch,
          HOME: process.env.HOME,
          TMPDIR: canaryScratch,
        },
        encoding: 'utf8',
      },
    )
  }

  const canaryLines = () =>
    readFile(canary, 'utf8').then(
      (text) => text.trim().split('\n').filter(Boolean),
      () => [],
    )

  it.each([
    [
      'a lane development database',
      databaseUrl('obiter_lane_security'),
      'database_protected',
    ],
    [
      'the shared product database',
      databaseUrl('obiter'),
      'database_protected',
    ],
    [
      'the shared corpus database',
      databaseUrl('obiter_corpus'),
      'database_protected',
    ],
    [
      'a host query override',
      `${databaseUrl('obiter_test')}?host=db.internal`,
      'database_url_query_override',
    ],
    [
      'an encoded name',
      databaseUrl('obiter%5Flane%5Fsecurity'),
      'database_name_encoded',
    ],
  ])('refuses %s without spawning anything', async (_label, url, code) => {
    const result = runHarness(['--runtime', 'node', '--database-url', url])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`${code}:`)
    // No shim ran: no psql (connection), no bun/node (API boot and migration),
    // no python3 (fixtures), no git. Nothing reached the target.
    expect(await canaryLines()).toEqual([])
  })

  it('spawns when the target is accepted, so the canary is not vacuous', async () => {
    runHarness([
      '--runtime',
      'node',
      '--database-url',
      databaseUrl('obiter_api_runtime_test'),
    ])
    const spawned = await canaryLines()
    expect(spawned).toContain('git')
    expect(spawned).toContain('bun')
  })
})
