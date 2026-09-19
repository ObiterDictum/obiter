import { Pool } from 'pg'
import type { ApiEnv } from './env'

/**
 * Legal-corpus access for one process.
 *
 * `pool` is where corpus reads run. `readOnly` is true when this process has no
 * corpus write path, so hydration answers the current request from the provider
 * and does not persist the result. There is no intermediate state: either the
 * corpus is the application database and writes behave as they always have, or
 * it is a different database that this process can only read.
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
 * Two `DATABASE_URL`s can name one database and differ as strings (a password
 * added, a parameter appended). Treating those as separate databases would put
 * the corpus into read-only mode by accident, so colocation is decided by the
 * host and database name, which are what identify a database.
 */
function sameDatabase(left: string, right: string) {
  const a = new URL(left)
  const b = new URL(right)
  return a.host === b.host && a.pathname === b.pathname
}

/**
 * The one owner of the process's database pools.
 *
 * When the corpus resolves to the application database — the default, and the
 * compatibility seam this change adds — there is a single pool and the corpus
 * access points at it. Closing twice cannot close a pool still in use, because
 * there is only ever one `end()` for it.
 */
export function createDatabasePools(env: ApiEnv): DatabasePools {
  const application = new Pool({ connectionString: env.databaseUrl })
  const colocated = sameDatabase(env.corpusDatabaseUrl, env.databaseUrl)
  const corpusPool = colocated
    ? application
    : new Pool({ connectionString: env.corpusDatabaseUrl })

  let closed = false

  return {
    application,
    corpus: { pool: corpusPool, readOnly: !colocated },
    async close() {
      if (closed) {
        return
      }
      closed = true
      await application.end()
      if (!colocated) {
        await corpusPool.end()
      }
    },
  }
}
