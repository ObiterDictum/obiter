import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readApiEnv } from './env'

/**
 * Focused matrix for the corpus connection variables, kept out of `env.test.ts`
 * because it is a two-dimensional matrix (variable x spelling) and that file is
 * already large. It covers two rules: a corpus URL must be a PostgreSQL URL
 * naming one database, and under `NODE_ENV=test` it must resolve to the test
 * database's parsed identity, not its exact string.
 */

const originalEnv = { ...process.env }

const TEST_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
const testDatabaseUrl = 'postgres://obiter:obiter@localhost:5432/obiter_test'
const developmentDatabaseUrl = 'postgres://obiter:obiter@localhost:5432/obiter'
const developmentReaderUrl = 'postgres://reader@localhost:5432/obiter_corpus'

type CorpusKey = 'CORPUS_DATABASE_URL' | 'CORPUS_WRITE_DATABASE_URL'
const corpusKeys: CorpusKey[] = [
  'CORPUS_DATABASE_URL',
  'CORPUS_WRITE_DATABASE_URL',
]

afterEach(() => {
  process.env = { ...originalEnv }
})

beforeEach(() => {
  delete process.env.CORPUS_DATABASE_URL
  delete process.env.CORPUS_WRITE_DATABASE_URL
})

function seedDevelopmentEnv() {
  process.env.NODE_ENV = 'development'
  process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET
  process.env.DATABASE_URL = developmentDatabaseUrl
}

function seedTestEnv() {
  process.env.NODE_ENV = 'test'
  process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET
  process.env.MEILISEARCH_SEARCH_API_KEY = 'test-search-key'
  process.env.MEILISEARCH_ADMIN_API_KEY = 'test-admin-key'
  delete process.env.DATABASE_URL
  process.env.TEST_DATABASE_URL = testDatabaseUrl
}

/** Parse one corpus variable on its own, with a valid reader when the variable
 * under test is the writer, so only the value under test can fail. */
function readCorpus(key: CorpusKey, value: string, testMode: boolean) {
  if (testMode) {
    seedTestEnv()
    process.env.CORPUS_DATABASE_URL = testDatabaseUrl
  } else {
    seedDevelopmentEnv()
    if (key === 'CORPUS_WRITE_DATABASE_URL') {
      process.env.CORPUS_DATABASE_URL = developmentReaderUrl
    }
  }
  process.env[key] = value
  return readApiEnv()
}

function corpusUrlOf(key: CorpusKey) {
  const env = readApiEnv()
  return key === 'CORPUS_DATABASE_URL'
    ? env.corpusDatabaseUrl
    : env.corpusWriteDatabaseUrl
}

describe.each(corpusKeys)('corpus URL validation for %s', (key) => {
  it('accepts a postgres: URL', () => {
    expect(
      readCorpus(key, 'postgres://reader@localhost:5432/obiter_corpus', false),
    ).toBeDefined()
  })

  it('accepts a postgresql: URL', () => {
    expect(
      readCorpus(
        key,
        'postgresql://reader@localhost:5432/obiter_corpus',
        false,
      ),
    ).toBeDefined()
  })

  it('accepts and preserves a percent-encoded database name', () => {
    readCorpus(key, 'postgres://reader@localhost:5432/obiter%5Fcorpus', false)

    expect(corpusUrlOf(key)).toContain('%5Fcorpus')
  })

  it('refuses a non-postgres scheme', () => {
    expect(() =>
      readCorpus(key, 'https://db-host/obiter_corpus', false),
    ).toThrow(`${key} must use the postgres: or postgresql: scheme.`)
  })

  it('refuses a URL with no database name', () => {
    expect(() => readCorpus(key, 'postgres://writer@db-host', false)).toThrow(
      `${key} must name a database.`,
    )
  })

  it('refuses a root-only path', () => {
    expect(() => readCorpus(key, 'postgres://db-host/', false)).toThrow(
      `${key} must name a database.`,
    )
  })

  it('refuses a decoded name containing a path separator', () => {
    expect(() =>
      readCorpus(key, 'postgres://db-host/obiter%2Fcorpus', false),
    ).toThrow(`${key} must name exactly one database.`)
  })

  it('refuses a decoded name containing a control character', () => {
    expect(() =>
      readCorpus(key, 'postgres://db-host/obiter%00corpus', false),
    ).toThrow(`${key} must name exactly one database.`)
  })

  it('refuses a malformed URL', () => {
    expect(() => readCorpus(key, 'not a url', false)).toThrow(
      `${key} must be a valid PostgreSQL URL.`,
    )
  })

  it('refuses a blank value', () => {
    expect(() => readCorpus(key, '   ', false)).toThrow(
      `${key} must not be blank or padded with whitespace.`,
    )
  })
})

const acceptedTestCorpusUrls: Array<[string, string]> = [
  ['the exact URL', testDatabaseUrl],
  [
    'a different permitted role',
    'postgres://other:password@localhost:5432/obiter_test',
  ],
  [
    'an equivalent percent encoding',
    'postgres://obiter:obiter@localhost:5432/obiter%5Ftest',
  ],
  ['an omitted default port', 'postgres://obiter:obiter@localhost/obiter_test'],
  [
    'an equivalent trailing slash',
    'postgres://obiter:obiter@localhost:5432/obiter_test/',
  ],
]

const refusedTestCorpusUrls: Array<[string, string]> = [
  [
    'a different database',
    'postgres://obiter:obiter@localhost:5432/obiter_other_test',
  ],
  ['a different host', 'postgres://obiter:obiter@db.internal:5432/obiter_test'],
  [
    'a different non-default port',
    'postgres://obiter:obiter@localhost:5433/obiter_test',
  ],
]

describe.each(corpusKeys)('test-mode identity for %s', (key) => {
  it.each(acceptedTestCorpusUrls)('accepts %s', (_label, url) => {
    readCorpus(key, url, true)

    expect(corpusUrlOf(key)).not.toBeNull()
  })

  it.each(refusedTestCorpusUrls)('refuses %s', (_label, url) => {
    expect(() => readCorpus(key, url, true)).toThrow(
      `${key} must match TEST_DATABASE_URL.`,
    )
  })
})

it('does not echo a refused corpus value or its credentials', () => {
  seedTestEnv()
  process.env.CORPUS_DATABASE_URL =
    'postgres://user:sup3rsecret@localhost:5432/other_corpus'

  let message = ''
  try {
    readApiEnv()
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  expect(message).toContain('CORPUS_DATABASE_URL must match TEST_DATABASE_URL.')
  expect(message).not.toContain('sup3rsecret')
  expect(message).not.toContain('other_corpus')
})
