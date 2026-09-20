import { Pool } from 'pg'
import type { ApiEnv } from './env'

/**
 * Legal-corpus access for one process.
 *
 * `read` is where corpus reads run. `write` is where corpus writes run, or
 * `null` when this process has no corpus write path: an explicitly configured
 * read-only corpus, which is the ordinary lane configuration. The two are
 * separate bindings rather than a mode flag, so a process with no writer is
 * never handed one to attempt.
 */
export interface CorpusAccess {
  read: Pool
  write: Pool | null
}

export interface DatabasePools {
  /** Matter, auth, audit and every other application write. */
  application: Pool
  /** Legal-corpus reads, and the corpus write path when one exists. */
  corpus: CorpusAccess
  /** Idempotent; closes each distinct pool exactly once. */
  close(): Promise<void>
}

/**
 * The one owner of the process's database pools.
 *
 * The mode is decided by configuration provenance, not by comparing connection
 * strings. With neither corpus variable set, the corpus is the application
 * database: one pool serves reads and writes, exactly as before the seam
 * existed. `CORPUS_DATABASE_URL` alone declares a separate, read-only corpus
 * target. `CORPUS_WRITE_DATABASE_URL` adds a writer, and only a process given
 * that variable can persist hydration.
 *
 * That holds even when the URLs name the same physical database: a distinct
 * corpus credential is a distinct access boundary, and inferring one writable
 * owner from a host-and-database match would ignore the role the operator
 * chose. An explicitly configured reader and writer are therefore always
 * separate pools, even when their URLs are textually identical, and each
 * distinct pool is closed exactly once. A writer without an explicit reader is
 * refused here as well as in `readCorpusDatabaseUrls`, so the forbidden
 * read-application-write-corpus topology cannot be constructed by direct call.
 */
export function createDatabasePools(env: ApiEnv): DatabasePools {
  const readerUrl = env.corpusDatabaseUrl
  const writerUrl = env.corpusWriteDatabaseUrl
  // `readCorpusDatabaseUrls` already refuses this, but the factory is the last
  // boundary before pools exist and must not trust a hand-built environment.
  // A writer with no explicit reader would read the corpus from the
  // application pool and write it to a different database, which is exactly the
  // silent split the configuration refuses. Checked before any pool is built.
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

  // Compatibility shares the application pool across all three roles, so it is
  // added once. A Set keys on pool identity, which is exactly the "distinct
  // physical endpoint" rule: two pools built from equivalent URLs stay two.
  const pools = new Set<Pool>([application, readPool])
  if (writePool !== null) pools.add(writePool)

  let closePromise: Promise<void> | null = null

  return {
    application,
    corpus: { read: readPool, write: writePool },
    close() {
      // `??=` runs synchronously, before the first await, so concurrent
      // callers share one attempt. Each `end()` is bound once, so a repeated
      // or concurrent close cannot close a pool twice.
      closePromise ??= closePools([...pools].map((pool) => pool.end.bind(pool)))
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
