import { Pool } from 'pg'
import type { ApiEnv } from './env'

/**
 * Legal-corpus access for one process.
 *
 * `pool` is where corpus reads run. `readOnly` is true when this process has no
 * corpus write path, so hydration answers the current request from the provider
 * and does not persist the result.
 */
export interface CorpusAccess {
  pool: Pool
  readOnly: boolean
}

export interface DatabasePools {
  /** Matter, auth, audit and every other application write. */
  application: Pool
  /** Legal-corpus reads, and the mode they run in. */
  corpus: CorpusAccess
  /** Idempotent; closes each distinct pool exactly once. */
  close(): Promise<void>
}

/**
 * The one owner of the process's database pools.
 *
 * The mode is decided by configuration provenance, not by comparing connection
 * strings. With no `CORPUS_DATABASE_URL`, the corpus is the application
 * database: one pool, writable, exactly as before the seam existed. A
 * configured `CORPUS_DATABASE_URL` declares a separate corpus target and is
 * always served read-only. That holds even when the URL names the same
 * physical database as the application: a distinct corpus credential is a
 * distinct access boundary, and inferring that the two are one writable owner
 * from a host-and-database match would silently ignore the role the operator
 * chose. An operator who needs corpus writes leaves the variable unset.
 */
export function createDatabasePools(env: ApiEnv): DatabasePools {
  const application = new Pool({ connectionString: env.databaseUrl })
  const corpusDatabaseUrl = env.corpusDatabaseUrl
  const separateCorpus = corpusDatabaseUrl !== null
  const corpusPool = separateCorpus
    ? new Pool({ connectionString: corpusDatabaseUrl })
    : application

  let closePromise: Promise<void> | null = null

  return {
    application,
    corpus: { pool: corpusPool, readOnly: separateCorpus },
    close() {
      // `??=` runs synchronously, before the first await, so concurrent
      // callers share one attempt. Each `end()` is bound once, so a repeated
      // or concurrent close cannot close a pool twice.
      closePromise ??= closePools(
        separateCorpus
          ? [application.end.bind(application), corpusPool.end.bind(corpusPool)]
          : [application.end.bind(application)],
      )
      return closePromise
    },
  }
}

/**
 * Close every pool, and report a failure rather than abandoning the pools
 * after the first one. A pool whose `end()` rejects is not retried: the caller
 * gets the failure, and the pool is not closed a second time.
 */
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
