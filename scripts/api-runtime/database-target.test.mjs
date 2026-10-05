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
 * The regression this file exists for is the port split: pg resolves a missing
 * port from the ambient PGPORT while psql is pinned to 5432, so a validated
 * portless URL could send the API child's migrations to a cluster the guard
 * never checked. `pgEffectiveParameters` runs the real `pg` client in a child
 * of `services/api` (where the dependency resolves) so the assertion is the
 * driver's own resolution, not a reimplementation. `psqlEnvironment` is the
 * exact environment the fixtures are provisioned with.
 *
 * The last suite runs the real entry point with the process-spawning commands
 * (bun, node, psql, python3, git) replaced by canaries, so a rejected target
 * provably reaches none of them. The accepted-target control proves the canary
 * fires when the run does proceed, so the negative result is not vacuous.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { psqlEnvironment } from '../load/psql.mjs'
import { childEnvironment, parseArgs } from './config.mjs'
import { resolveDatabaseTarget } from './database-target.mjs'
import { childProcessEnvironment } from './lifecycle.mjs'

const WORKTREE_ROOT = join(import.meta.dir, '..', '..')
const databaseUrl = (name) => `postgres://obiter:obiter@localhost:5432/${name}`

// The real `pg` client's resolved parameters for a connection string, printed
// by a child of services/api so the workspace dependency resolves. `extraEnv`
// emulates an ambient PG* variable reaching the driver.
const PG_PARAMS_SCRIPT = `
import pg from 'pg'
const client = new pg.Client({ connectionString: process.argv[1] })
const p = client.connectionParameters
console.log(JSON.stringify({ host: p.host, port: p.port, database: p.database, user: p.user }))
`
function pgEffectiveParameters(url, extraEnv = {}) {
  const result = spawnSync(
    'node',
    ['--input-type=module', '-e', PG_PARAMS_SCRIPT, url],
    {
      cwd: join(WORKTREE_ROOT, 'services', 'api'),
      env: childProcessEnvironment(extraEnv, {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      }),
      encoding: 'utf8',
    },
  )
  if (result.status !== 0) {
    throw new Error(`pg parameter probe failed: ${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

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
    [
      'a URL with no user',
      'postgres://localhost:5432/obiter_test',
      'database_user_missing',
    ],
    [
      'a URL with no password',
      'postgres://obiter@localhost:5432/obiter_test',
      'database_password_missing',
    ],
    // Bracketed IPv6 is accepted by WHATWG URL but dialable by neither pg nor
    // psql, so it is refused rather than accepted and then unreachable.
    [
      'a bracketed IPv6 host',
      'postgres://obiter:obiter@[::1]:5432/obiter_test',
      'database_not_loopback',
    ],
    // Anything in the query reaches pg and psql differently, target key or not.
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
    [
      'an unrelated query parameter',
      `${databaseUrl('obiter_test')}?sslmode=require`,
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
  ])('accepts %s and names every component the consumers use', (name) => {
    expect(resolveDatabaseTarget({ databaseUrl: databaseUrl(name) })).toEqual({
      name,
      host: 'localhost',
      port: '5432',
      database: name,
      user: 'obiter',
      password: 'obiter',
      url: databaseUrl(name),
    })
  })

  it('serialises a portless URL into an explicit default port', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: 'postgres://obiter:obiter@localhost/obiter_test',
    })
    expect(target.port).toBe('5432')
    expect(target.url).toBe(
      'postgres://obiter:obiter@localhost:5432/obiter_test',
    )
  })

  it('keeps an explicit port and encodes credentials in the canonical URL', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: 'postgres://obiter:pa%3Dss@127.0.0.1:5999/obiter_test',
    })
    expect(target).toMatchObject({
      host: '127.0.0.1',
      port: '5999',
      database: 'obiter_test',
      user: 'obiter',
      password: 'pa=ss',
    })
    expect(target.url).toBe(
      'postgres://obiter:pa%3Dss@127.0.0.1:5999/obiter_test',
    )
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

  it('can only confirm the URL name, so it cannot redirect an owned database', () => {
    expect(
      refusal({
        databaseUrl: databaseUrl('obiter_test'),
        allowDatabase: 'other_test',
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

describe('the canonical target is what pg and psql actually resolve', () => {
  it('pins a portless URL to the default port even when PGPORT names another', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: 'postgres://obiter:obiter@localhost/obiter_test',
    })
    // The regression: pre-fix, target.url was portless and pg dialled PGPORT.
    expect(pgEffectiveParameters(target.url, { PGPORT: '59999' }).port).toBe(
      5432,
    )
    expect(psqlEnvironment(target.url).PGPORT).toBe('5432')
  })

  it('keeps an explicit port against a conflicting PGPORT for both consumers', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: 'postgres://obiter:obiter@localhost:5999/obiter_test',
    })
    expect(pgEffectiveParameters(target.url, { PGPORT: '5432' }).port).toBe(
      5999,
    )
    expect(psqlEnvironment(target.url).PGPORT).toBe('5999')
  })

  it.each([
    'postgres://obiter:obiter@localhost/obiter_test',
    'postgres://obiter:obiter@127.0.0.1:5999/obiter_api_runtime_test',
  ])('has pg and psql agree on host, port, database and user for %s', (url) => {
    const target = resolveDatabaseTarget({ databaseUrl: url })
    const pg = pgEffectiveParameters(target.url, {
      PGPORT: '1234',
      PGHOST: 'wrong.internal',
      PGDATABASE: 'wrong',
      PGUSER: 'wrong',
    })
    const psql = psqlEnvironment(target.url)
    expect(pg.port).toBe(Number(target.port))
    expect(pg.host).toBe(target.host)
    expect(pg.database).toBe(target.database)
    expect(pg.user).toBe(target.user)
    expect(psql.PGPORT).toBe(target.port)
    expect(psql.PGHOST).toBe(target.host)
    expect(psql.PGDATABASE).toBe(target.database)
    expect(psql.PGUSER).toBe(target.user)
    expect(psql.PGPASSWORD).toBe(target.password)
  })

  it('does not let a conflicting ambient PG* move the fixtures', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: 'postgres://obiter:obiter@localhost/obiter_test',
    })
    const environment = psqlEnvironment(target.url, {
      PATH: '/bin',
      HOME: '/tmp',
      PGPORT: '59999',
      PGHOST: 'wrong.internal',
      PGDATABASE: 'wrong',
      PGUSER: 'wrong',
      PGPASSWORD: 'wrong',
    })
    expect(environment.PGPORT).toBe('5432')
    expect(environment.PGHOST).toBe('localhost')
    expect(environment.PGDATABASE).toBe('obiter_test')
    expect(environment.PGUSER).toBe('obiter')
    expect(environment.PGPASSWORD).toBe('obiter')
  })
})

describe('argument parsing and launch propagation', () => {
  it('splits --flag=value on the first "=" so credentials survive', () => {
    const value = 'postgres://obiter:pa=ss@localhost:5432/obiter_test'
    expect(parseArgs([`--database-url=${value}`]).databaseUrl).toBe(value)
    expect(
      resolveDatabaseTarget({
        databaseUrl: 'postgres://obiter:pa%3Dss@localhost:5432/obiter_test',
      }).password,
    ).toBe('pa=ss')
  })

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

  it('gives the launched API the validated URL and PG* values, not ambient ones', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: databaseUrl('obiter_api_runtime_test'),
    })
    const environment = childEnvironment({
      port: 43210,
      target,
      storageRoot: '/tmp/obiter-api-runtime-test-storage',
    })
    // startServer merges `{ ...process.env, ...environment }` via
    // childProcessEnvironment, so reproduce it with conflicting ambient values.
    const ambient = {
      DATABASE_URL: databaseUrl('obiter_lane_security'),
      PGHOST: 'wrong.internal',
      PGPORT: '59999',
      PGDATABASE: 'wrong',
      PGUSER: 'wrong',
      PGPASSWORD: 'wrong',
      PGSERVICE: 'ambient-service',
      PGHOSTADDR: '10.0.0.1',
      PGPASSFILE: '/tmp/ambient.pgpass',
      PGSSLMODE: 'require',
      PATH: '/bin',
    }
    const child = childProcessEnvironment(environment, ambient)
    expect(child.DATABASE_URL).toBe(target.url)
    expect(child.PGHOST).toBe('localhost')
    expect(child.PGPORT).toBe('5432')
    expect(child.PGDATABASE).toBe('obiter_api_runtime_test')
    expect(child.PGUSER).toBe('obiter')
    expect(child.PGPASSWORD).toBe('obiter')
    // Inherited libpq variables the guard did not set are removed outright.
    for (const key of ['PGSERVICE', 'PGHOSTADDR', 'PGPASSFILE', 'PGSSLMODE']) {
      expect(child[key]).toBeUndefined()
    }
    expect(child.PATH).toBe('/bin')
    // The compatibility corpus mode must not inherit an ambient corpus URL.
    expect(child.CORPUS_DATABASE_URL).toBe('')
    expect(child.CORPUS_WRITE_DATABASE_URL).toBe('')
  })

  it('points the corpus-mode boots at the same canonical target', () => {
    const target = resolveDatabaseTarget({
      databaseUrl: databaseUrl('obiter_api_runtime_test'),
    })
    const boot = {
      ...childEnvironment({
        port: 43211,
        target,
        storageRoot: '/tmp/obiter-api-runtime-test-storage',
      }),
      CORPUS_DATABASE_URL: target.url,
      CORPUS_WRITE_DATABASE_URL: target.url,
    }
    expect(boot.CORPUS_DATABASE_URL).toBe(target.url)
    expect(boot.CORPUS_WRITE_DATABASE_URL).toBe(target.url)
    expect(boot.PGPORT).toBe(target.port)
    expect(boot.PGDATABASE).toBe(target.database)
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
    [
      'a URL with no user',
      'postgres://localhost:5432/obiter_test',
      'database_user_missing',
    ],
    [
      'a bracketed IPv6 host',
      'postgres://obiter:obiter@[::1]:5432/obiter_test',
      'database_not_loopback',
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
