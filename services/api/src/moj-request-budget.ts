import type { Pool, PoolClient } from 'pg'
import type {
  MojRequestBudget,
  MojRequestCharge,
} from '@obiter/legal-source-provider'

/**
 * How long a charge transaction waits for the single budget advisory lock
 * before failing closed. Normal charges hold the lock for single-digit
 * milliseconds, so this is generous headroom; beyond it the holder is treated
 * as wedged and the charge returns `unavailable` rather than stalling every
 * replica on one lock.
 */
export const DEFAULT_MOJ_REQUEST_LOCK_TIMEOUT_MS = 2_000

/**
 * How long any one statement in a charge transaction may run. It must not be
 * shorter than the lock bound, so a blocked lock is reported as a lock
 * timeout; it caps the sweep and count statements if the database is slow.
 */
export const DEFAULT_MOJ_REQUEST_STATEMENT_TIMEOUT_MS = 5_000

/**
 * How long a charge waits to acquire a pooled connection before failing
 * closed. `lock_timeout` and `statement_timeout` only bound statements once a
 * connection exists; `pg` waits forever for a free client from an exhausted
 * pool, so without this bound a saturated pool would stall a charge rather
 * than fail closed.
 */
export const DEFAULT_MOJ_REQUEST_CONNECT_TIMEOUT_MS = 5_000

export interface PostgresMojRequestBudgetConfig {
  /** Upstream HTTP attempts allowed across every replica in the window. */
  limit: number
  /** Rolling window length in milliseconds. */
  windowMs: number
  /** Bound on waiting to acquire a pooled connection. */
  connectTimeoutMs: number
  /** Bound on waiting for the budget advisory lock. */
  lockTimeoutMs: number
  /** Bound on any one statement in the charge transaction. */
  statementTimeoutMs: number
}

/**
 * The cluster-visible Find Case Law request budget.
 *
 * It lives on the application database (`DATABASE_URL`), the database every
 * API replica migrates at boot and may write, and is deliberately not the
 * legal corpus: a lane has no corpus writer, and licensed source material
 * must not carry operational request rows. Bulk ingestion runs with its own
 * corpus-writer connection and does not reach this ledger, so the shared
 * window today covers the API replicas only, not the ingestor.
 *
 * The window is persisted rows counted inside one transaction, not the
 * advisory lock. The lock only makes check-and-record atomic across replicas:
 * an advisory lock alone would serialise writers without holding the window,
 * so it could not answer "how many attempts in the last five minutes" after a
 * restart or on another replica. The database clock, not any replica's, is
 * the authority for both the write and the count, so clock skew cannot widen
 * or narrow the window.
 *
 * A row is a timestamp and nothing else: no URL, query text, subject, user
 * identity or matter data is persisted, so the ledger cannot reconstruct what
 * was fetched or by whom.
 */
export class PostgresMojRequestBudget implements MojRequestBudget {
  constructor(
    private readonly pool: Pool,
    private readonly config: PostgresMojRequestBudgetConfig,
  ) {
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(
          `Postgres Find Case Law request budget ${name} must be a positive number.`,
        )
      }
    }
    if (config.statementTimeoutMs < config.lockTimeoutMs) {
      throw new Error(
        'Postgres Find Case Law request budget statementTimeoutMs must be at least lockTimeoutMs, so a blocked charge reports a lock timeout.',
      )
    }
  }

  async charge(): Promise<MojRequestCharge> {
    const client = await connectWithin(this.pool, this.config.connectTimeoutMs)
    if (!client) {
      // Fail closed: the caller dispatches no request it cannot show is
      // inside the allowance.
      console.error('Find Case Law request budget ledger unavailable')
      return { status: 'unavailable' }
    }

    try {
      await client.query('begin')
      // Bound the wait for the cluster-wide budget lock. Postgres defaults
      // both timeouts to 0 (wait forever), so a wedged holder would stall
      // every charge on every replica instead of failing closed. Both are
      // transaction-local, so the pooled connection returns to its previous
      // settings on commit or rollback.
      await client.query(`select set_config('lock_timeout', $1, true)`, [
        `${this.config.lockTimeoutMs}ms`,
      ])
      await client.query(`select set_config('statement_timeout', $1, true)`, [
        `${this.config.statementTimeoutMs}ms`,
      ])
      await client.query(
        `select pg_advisory_xact_lock(hashtext('legal_moj_request_budget'))`,
      )
      // Housekeeping only: the count below filters on time, so an
      // out-of-window row is already excluded even before it is swept.
      // Deleting keeps the table bounded by the live window.
      await client.query(
        `delete from legal_moj_request_charges
          where charged_at <= now() - ($1::bigint * interval '1 millisecond')`,
        [this.config.windowMs],
      )
      const window = await client.query<{
        count: string
        retry_after_seconds: string
      }>(
        `select
            count(*)::text as count,
            coalesce(
              ceil(extract(epoch from (
                min(charged_at) + ($1::bigint * interval '1 millisecond') - now()
              ))),
              0
            )::text as retry_after_seconds
           from legal_moj_request_charges
          where charged_at > now() - ($1::bigint * interval '1 millisecond')`,
        [this.config.windowMs],
      )

      if (Number(window.rows[0]?.count ?? '0') >= this.config.limit) {
        await client.query('rollback')
        // The oldest in-window charge is what frees the next slot, so the
        // caller gets a meaningful wait rather than a fixed guess. At least
        // one second, so a rounding error cannot invite an immediate retry.
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(Number(window.rows[0]?.retry_after_seconds ?? '1')),
        )
        return { status: 'rate_limited', retryAfterSeconds }
      }

      await client.query('insert into legal_moj_request_charges default values')
      await client.query('commit')
      return { status: 'allowed' }
    } catch {
      await rollbackQuietly(client)
      // No URL, query, subject or identity is logged: the error names the
      // failure, nothing about the attempt.
      console.error('Find Case Law request budget ledger unavailable')
      return { status: 'unavailable' }
    } finally {
      client.release()
    }
  }
}

/**
 * Compose the cluster-wide budget with the per-process backstop.
 *
 * The per-process limiter is charged first so it never spends a shared slot on
 * an attempt this replica refuses, and the shared charge is the last thing that
 * happens before dispatch, so an attempt refused here reaches no provider. The
 * backstop cannot widen the shared window, only tighten it: with the process
 * limit at or above the shared limit it rarely binds, and if it does it can
 * only refuse, never admit past the shared ledger.
 *
 * With no shared budget configured (single-process development, tests), the
 * process limiter is the whole budget, exactly as before this change.
 */
export function composeMojRequestBudget(
  shared: MojRequestBudget | undefined,
  local: MojRequestBudget,
): MojRequestBudget {
  if (!shared) return local
  return {
    async charge(now) {
      const localCharge = await local.charge(now)
      if (localCharge.status !== 'allowed') return localCharge
      return shared.charge(now)
    },
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback')
  } catch {
    // The connection is already broken; there is nothing to roll back.
  }
}

/**
 * Acquire a pooled client within `timeoutMs`, or null. A client that arrives
 * after the timeout is still released, so a bounded charge never leaks a
 * connection back into the pool it could not get one from.
 */
async function connectWithin(
  pool: Pool,
  timeoutMs: number,
): Promise<PoolClient | null> {
  const connecting = pool.connect()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })

  let client: PoolClient | null
  try {
    client = await Promise.race([connecting, timeout])
  } catch {
    if (timer) clearTimeout(timer)
    return null
  }
  if (timer) clearTimeout(timer)

  if (client === null) {
    // The acquisition may still resolve after the timeout won; release that
    // client rather than leaking it.
    void connecting.then((late) => late.release()).catch(() => {})
    return null
  }
  return client
}
