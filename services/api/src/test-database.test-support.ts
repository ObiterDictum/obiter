import { Pool } from 'pg'
import { readDatabaseIdentity, sameDatabaseIdentity } from './database-identity'

const testDatabaseSuffix = '_test'

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

  for (const key of ['CORPUS_DATABASE_URL', 'CORPUS_WRITE_DATABASE_URL']) {
    const corpusUrl = process.env[key]
    if (!corpusUrl) continue
    if (!sameDatabaseIdentity(readDatabaseIdentity(corpusUrl, key), identity)) {
      throw new Error(
        `${key} must not point a database-backed suite at a shared corpus; unset it, or set it to TEST_DATABASE_URL.`,
      )
    }
  }

  return url
}

export function createTestPool(): Pool {
  return new Pool({ connectionString: requireTestDatabaseUrl() })
}
