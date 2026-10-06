import { afterEach, describe, expect, it } from 'bun:test'
import { requireTestDatabaseUrl } from './test-database.test-support'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

const testDatabaseUrl =
  'postgres://obiter:obiter@localhost:5432/obiter_lane_search_test'

function setEnv(values: Record<string, string | undefined>) {
  // Both corpus variables are cleared by default: a value inherited from the
  // shell must not make one of these assertions pass or fail by accident.
  const cleared = {
    CORPUS_DATABASE_URL: undefined,
    CORPUS_WRITE_DATABASE_URL: undefined,
    ...values,
  }
  for (const [key, value] of Object.entries(cleared)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('requireTestDatabaseUrl', () => {
  it('requires TEST_DATABASE_URL', () => {
    setEnv({ TEST_DATABASE_URL: undefined, CORPUS_DATABASE_URL: undefined })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'TEST_DATABASE_URL is required',
    )
  })

  it('rejects a malformed URL', () => {
    setEnv({ TEST_DATABASE_URL: 'not a url', CORPUS_DATABASE_URL: undefined })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'TEST_DATABASE_URL must be a valid PostgreSQL URL.',
    )
  })

  it('rejects a database whose name does not end in _test', () => {
    setEnv({
      TEST_DATABASE_URL: 'postgres://obiter:obiter@localhost:5432/obiter',
      CORPUS_DATABASE_URL: undefined,
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'must name a *_test database',
    )
  })

  it('accepts the isolated lane test database', () => {
    setEnv({
      TEST_DATABASE_URL: testDatabaseUrl,
      CORPUS_DATABASE_URL: undefined,
    })

    expect(requireTestDatabaseUrl()).toBe(testDatabaseUrl)
  })

  it('reads the database name past percent-encoding', () => {
    const encoded =
      'postgres://obiter:obiter@localhost:5432/obiter%5Flane%5Fsearch%5Ftest'
    setEnv({ TEST_DATABASE_URL: encoded, CORPUS_DATABASE_URL: undefined })

    expect(requireTestDatabaseUrl()).toBe(encoded)
  })

  it('refuses a percent-encoded name that is not a test database', () => {
    setEnv({
      TEST_DATABASE_URL: 'postgres://h/obiter%5Fprod',
      CORPUS_DATABASE_URL: undefined,
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'must name a *_test database',
    )
  })

  it('ignores query and fragment decorations when reading the name', () => {
    setEnv({
      TEST_DATABASE_URL: 'postgres://h/obiter_test?dbname=prod#fragment',
      CORPUS_DATABASE_URL: undefined,
    })

    expect(requireTestDatabaseUrl()).toContain('/obiter_test')
  })

  it('does not let a query string supply the test suffix', () => {
    setEnv({
      TEST_DATABASE_URL: 'postgres://h/obiter_prod?name=obiter_test',
      CORPUS_DATABASE_URL: undefined,
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'must name a *_test database',
    )
  })

  it('normalises a trailing slash on the test database', () => {
    setEnv({
      TEST_DATABASE_URL: 'postgres://h/obiter_test/',
      CORPUS_DATABASE_URL: undefined,
    })

    expect(requireTestDatabaseUrl()).toBe('postgres://h/obiter_test/')
  })

  it('refuses a trailing slash that hides a non-test database', () => {
    setEnv({
      TEST_DATABASE_URL: 'postgres://h/obiter_prod/',
      CORPUS_DATABASE_URL: undefined,
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'must name a *_test database',
    )
  })

  it('refuses a corpus target that resolves elsewhere', () => {
    setEnv({
      TEST_DATABASE_URL: testDatabaseUrl,
      CORPUS_DATABASE_URL:
        'postgres://obiter:obiter@localhost:5432/obiter_corpus',
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'must not point a database-backed suite at a shared corpus',
    )
  })

  it('accepts a corpus URL written differently for the same test database', () => {
    setEnv({
      TEST_DATABASE_URL: testDatabaseUrl,
      CORPUS_DATABASE_URL:
        'postgres://obiter:obiter@localhost:5432/obiter_lane_search_test/',
    })

    expect(requireTestDatabaseUrl()).toBe(testDatabaseUrl)
  })

  it('refuses an inherited production-like corpus variable under NODE_ENV=test', () => {
    setEnv({
      NODE_ENV: 'test',
      TEST_DATABASE_URL: testDatabaseUrl,
      CORPUS_DATABASE_URL: 'postgres://obiter:obiter@db.internal:5432/obiter',
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'must not point a database-backed suite at a shared corpus',
    )
  })

  it('refuses a corpus writer target that resolves elsewhere', () => {
    setEnv({
      TEST_DATABASE_URL: testDatabaseUrl,
      CORPUS_DATABASE_URL: testDatabaseUrl,
      CORPUS_WRITE_DATABASE_URL:
        'postgres://obiter:obiter@localhost:5432/obiter_corpus',
    })

    expect(() => requireTestDatabaseUrl()).toThrow(
      'CORPUS_WRITE_DATABASE_URL must not point a database-backed suite at a shared corpus',
    )
  })

  it('accepts a corpus writer URL written differently for the same test database', () => {
    setEnv({
      TEST_DATABASE_URL: testDatabaseUrl,
      CORPUS_DATABASE_URL: testDatabaseUrl,
      CORPUS_WRITE_DATABASE_URL:
        'postgres://obiter_writer@localhost:5432/obiter_lane_search_test',
    })

    expect(requireTestDatabaseUrl()).toBe(testDatabaseUrl)
  })
})
