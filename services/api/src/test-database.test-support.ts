import { Pool } from 'pg'
import { readDatabaseIdentity, sameDatabaseIdentity } from './database-identity'

const testDatabaseSuffix = '_test'

/**
 * The one place a database-backed suite resolves its connection target.
 *
 * These suites seed and delete rows, so the target has to be the isolated test
 * database: a `*_test` database name, and no corpus target pointing anywhere
 * else. `readApiEnv` enforces the same rules for the running API; this exists
 * because the suites build their own pools and would otherwise bypass that
 * validation entirely, which is how a suite ends up deleting the real Human
 * Rights Act.
 *
 * The name is read from the parsed and percent-decoded path, not matched
 * against the raw string, so a query, fragment, trailing slash or encoded
 * character cannot disguise the target. It is still a name-only control: a
 * `*_test` database on a shared host passes, and host aliases are treated as
 * different because resolving them needs DNS.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required for the database-backed suites (see TESTING.md).',
    )
  }

  const identity = readDatabaseIdentity(url, 'TEST_DATABASE_URL')
  if (!identity.database.endsWith(testDatabaseSuffix)) {
    throw new Error(
      `TEST_DATABASE_URL must name a *${testDatabaseSuffix} database; it names "${identity.database}".`,
    )
  }

  // A corpus URL that resolves anywhere else is a production or shared
  // credential the suite inherited from its shell. Refusing is the only safe
  // reading: the suite cannot know what it would be deleting. Comparing parsed
  // identities rather than raw strings still accepts a different spelling of
  // the same test database.
  const corpusUrl = process.env.CORPUS_DATABASE_URL
  if (
    corpusUrl &&
    !sameDatabaseIdentity(
      readDatabaseIdentity(corpusUrl, 'CORPUS_DATABASE_URL'),
      identity,
    )
  ) {
    throw new Error(
      'CORPUS_DATABASE_URL must not point a database-backed suite at a shared corpus; unset it, or set it to TEST_DATABASE_URL.',
    )
  }

  return url
}

/** A pool against the isolated test database, with the guard applied. */
export function createTestPool(): Pool {
  return new Pool({ connectionString: requireTestDatabaseUrl() })
}
