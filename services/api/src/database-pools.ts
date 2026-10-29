import { Pool } from 'pg'
import type { ApiEnv } from './env'

export interface CorpusAccess {
  read: Pool
  write: Pool | null
}

export interface DatabasePools {
  application: Pool
  corpus: CorpusAccess
  close(): Promise<void>
}

export function createDatabasePools(env: ApiEnv): DatabasePools {
  const readerUrl = env.corpusDatabaseUrl
  const writerUrl = env.corpusWriteDatabaseUrl
  if (writerUrl !== null && readerUrl === null) {
    throw new Error(
      'CORPUS_WRITE_DATABASE_URL requires CORPUS_DATABASE_URL, or the process would read and write different databases.',
    )
  }

  const application = new Pool({ connectionString: env.databaseUrl })
  const readPool =
    readerUrl === null ? application : new Pool({ connectionString: readerUrl })
  const writePool =
    writerUrl !== null
      ? new Pool({ connectionString: writerUrl })
      : readerUrl === null
        ? application
        : null

  const pools = new Set<Pool>([application, readPool])
  if (writePool !== null) pools.add(writePool)

  let closePromise: Promise<void> | null = null

  return {
    application,
    corpus: { read: readPool, write: writePool },
    close() {
      closePromise ??= closePools([...pools].map((pool) => pool.end.bind(pool)))
      return closePromise
    },
  }
}

async function closePools(ends: Array<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(ends.map((end) => end()))
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failures.length === 0) return
  if (failures.length === 1) throw failures[0].reason
  throw new AggregateError(
    failures.map((failure) => failure.reason),
    'Database pool shutdown failed.',
  )
}
