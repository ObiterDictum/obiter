import type { NodeEnv } from '@obiter/config'
import { readDatabaseIdentity, sameDatabaseIdentity } from './database-identity'

// Corpus reads fall back to this database, so its name is what separates
// throwaway test data from a populated database.
const testDatabaseSuffix = '_test'

/** The corpus connection targets `readCorpusDatabaseUrls` resolved. */
export interface CorpusDatabaseUrls {
  corpusDatabaseUrl: string | null
  corpusWriteDatabaseUrl: string | null
}

/**
 * A corpus connection string has to be a PostgreSQL URL naming one database,
 * not merely a syntactically valid URL. `readDatabaseIdentity` enforces the
 * scheme and the name; this also normalises the stored value. The variable and
 * reason are named in the error, never its value or any credential.
 */
function readDatabaseUrlForCorpus(key: string, value: string): string {
  readDatabaseIdentity(value, key)

  return new URL(value).toString().replace(/\/$/, '')
}

/** An explicitly configured URL, or null when the variable is unset or empty.
 * A blank or padded value is refused rather than read as absent, so a stray
 * space cannot leave a writer disabled while the operator believes it is on. */
function readConfiguredUrl(key: string): string | null {
  const value = process.env[key]
  if (value === undefined || value === '') return null

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed !== value) {
    throw new Error(`${key} must not be blank or padded with whitespace.`)
  }

  return readDatabaseUrlForCorpus(key, trimmed)
}

/**
 * Legal-corpus resolution. Both null means no separate corpus target, so the
 * corpus is the application database. A writer with no explicit reader is
 * refused: reads and writes must not silently target unrelated databases, and
 * the writer is the only capability that lets a process persist hydration.
 * Test runs must stay on `*_test` for both, because database-backed suites
 * seed and delete corpus rows.
 */
export function readCorpusDatabaseUrls(
  nodeEnv: NodeEnv,
  databaseUrl: string,
): CorpusDatabaseUrls {
  const corpusDatabaseUrl = readConfiguredUrl('CORPUS_DATABASE_URL')
  const corpusWriteDatabaseUrl = readConfiguredUrl('CORPUS_WRITE_DATABASE_URL')

  if (corpusWriteDatabaseUrl !== null && corpusDatabaseUrl === null) {
    throw new Error(
      'CORPUS_WRITE_DATABASE_URL requires CORPUS_DATABASE_URL, or the process would read and write different databases.',
    )
  }

  if (nodeEnv !== 'test') {
    return { corpusDatabaseUrl, corpusWriteDatabaseUrl }
  }

  const testIdentity = readDatabaseIdentity(databaseUrl, 'TEST_DATABASE_URL')
  if (!testIdentity.database.endsWith(testDatabaseSuffix)) {
    throw new Error('TEST_DATABASE_URL must name a *_test database.')
  }
  // Parsed identity, not raw string equality, so a differently spelled URL for
  // the same test database (another role, encoded name, implicit port) is
  // accepted here exactly as `requireTestDatabaseUrl` accepts it. Both corpus
  // variables are checked against the same identity, and a genuinely different
  // host, port or database is still refused.
  if (
    corpusDatabaseUrl !== null &&
    !sameDatabaseIdentity(
      readDatabaseIdentity(corpusDatabaseUrl, 'CORPUS_DATABASE_URL'),
      testIdentity,
    )
  ) {
    throw new Error('CORPUS_DATABASE_URL must match TEST_DATABASE_URL.')
  }
  if (
    corpusWriteDatabaseUrl !== null &&
    !sameDatabaseIdentity(
      readDatabaseIdentity(corpusWriteDatabaseUrl, 'CORPUS_WRITE_DATABASE_URL'),
      testIdentity,
    )
  ) {
    throw new Error('CORPUS_WRITE_DATABASE_URL must match TEST_DATABASE_URL.')
  }
  return { corpusDatabaseUrl, corpusWriteDatabaseUrl }
}
