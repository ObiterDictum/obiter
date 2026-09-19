import { Pool } from 'pg'

const testDatabaseSuffix = '_test'

/**
 * The one place a database-backed suite resolves its connection target.
 *
 * These suites seed and delete rows, so the target has to be the isolated test
 * database: a `*_test` name, and never anything that could be a shared corpus.
 * `readApiEnv` enforces the same rules for the running API; this exists because
 * the suites build their own pools and would otherwise bypass that validation
 * entirely, which is how a suite ends up deleting the real Human Rights Act.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required for the database-backed suites (see TESTING.md).',
    )
  }

  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith(testDatabaseSuffix)) {
    throw new Error(
      `TEST_DATABASE_URL must name a *${testDatabaseSuffix} database; it names "${name}".`,
    )
  }

  // A corpus URL that is not the test database is a production or shared
  // credential the suite inherited from its shell. Refusing is the only safe
  // reading: the suite cannot know what it would be deleting.
  const corpusUrl = process.env.CORPUS_DATABASE_URL
  if (corpusUrl && new URL(corpusUrl).toString() !== new URL(url).toString()) {
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
