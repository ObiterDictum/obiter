import type { NodeEnv } from '@obiter/config'
import { readDatabaseIdentity, sameDatabaseIdentity } from './database-identity'

const testDatabaseSuffix = '_test'

export interface CorpusDatabaseUrls {
  corpusDatabaseUrl: string | null
  corpusWriteDatabaseUrl: string | null
}

function readDatabaseUrlForCorpus(key: string, value: string): string {
  readDatabaseIdentity(value, key)

  return new URL(value).toString().replace(/\/$/, '')
}

function readConfiguredUrl(key: string): string | null {
  const value = process.env[key]
  if (value === undefined || value === '') return null

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed !== value) {
    throw new Error(`${key} must not be blank or padded with whitespace.`)
  }

  return readDatabaseUrlForCorpus(key, trimmed)
}

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
