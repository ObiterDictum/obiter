import type { Pool, PoolClient } from 'pg'
import type {
  HydrationAdmission,
  LegalHydrationLedger,
} from './legal-search-hydration-budget'

/**
 * How long an admission transaction waits for the single admission advisory
 * lock before failing closed. Normal admissions hold the lock for single-digit
 * milliseconds, so this is generous headroom; beyond it the holder is treated
 * as wedged and admission returns `unavailable` rather than hanging every
 * replica on one lock.
 */
export const DEFAULT_HYDRATION_ADMISSION_LOCK_TIMEOUT_MS = 2_000

/**
 * How long any one admission statement may run. It must not be shorter than the
 * lock bound, so a blocked lock is reported as a lock timeout; it caps the
 * sweep and count statements if the database is slow to execute them.
 */
export const DEFAULT_HYDRATION_ADMISSION_STATEMENT_TIMEOUT_MS = 5_000

export interface PostgresLegalHydrationLedgerConfig {
  /**
   * Unexpired in-flight leases allowed across every replica. This bounds the
   * leases the ledger counts, not every still-running operation: an operation
   * that outlives `leaseTtlMs` drops out of the count, so a second operation
   * can be admitted while the first still runs.
   */
  queueMax: number
  /** Distinct misses one subject may charge in the rolling window. */
  perClientMax: number
  /** Rolling window length in milliseconds. */
  windowMs: number
  /**
   * How long an unreleased lease keeps its in-flight slot. It must exceed the
   * longest legitimate operation, so a slow-but-alive replica is not
   * over-admitted; a crashed replica holds capacity for at most this long, and
   * so does an operation that outlives its lease.
   */
  leaseTtlMs: number
  /** Bound on waiting for the admission advisory lock. */
  lockTimeoutMs: number
  /** Bound on any one statement in the admission transaction. */
  statementTimeoutMs: number
}

/**
 * The cluster-visible hydration admission authority.
 *
 * It lives on the application database (`DATABASE_URL`): the database every
 * API replica migrates at boot and may write. It is deliberately not the
 * legal corpus, whose lane configuration is read-only (`CORPUS_DATABASE_URL`
 * alone gives the process no corpus writer) and whose contents are licensed
 * source material that operational rows must not join.
 *
 * The window is persisted rows counted inside one transaction, not an
 * advisory lock. The lock only makes the check-and-record atomic across
 * replicas: an advisory lock alone would serialise writers without holding
 * the window, so it could not answer "how many misses in the last ten
 * minutes" after a restart.
 *
 * Cross-replica same-key deduplication is deliberately not provided. Two
 * replicas admitting the same canonical key both take a lease and both charge
 * a miss; only the in-process gate deduplicates equivalent work, and only
 * within one process. The canonical key is therefore not persisted at all.
 */
export class PostgresLegalHydrationLedger implements LegalHydrationLedger {
  constructor(
    private readonly pool: Pool,
    private readonly config: PostgresLegalHydrationLedgerConfig,
  ) {
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(
          `Postgres hydration ledger ${name} must be a positive number.`,
        )
      }
    }
    if (config.statementTimeoutMs < config.lockTimeoutMs) {
      throw new Error(
        'Postgres hydration ledger statementTimeoutMs must be at least lockTimeoutMs, so a blocked admission reports a lock timeout.',
      )
    }
  }

  async admit(
    subject: string,
    _key: string,
    chargeMiss: boolean,
  ): Promise<HydrationAdmission> {
    const leaseId = crypto.randomUUID()
    let client: PoolClient
    try {
      client = await this.pool.connect()
    } catch {
      // Fail closed. The caller refuses new hydration; stored reads run on
      // other pools and keep serving.
      console.error('Legal hydration admission ledger unavailable')
      return { status: 'unavailable' }
    }

    try {
      await client.query('begin')
      // Bound the wait for the cluster-wide admission lock. Postgres defaults
      // `lock_timeout` and `statement_timeout` to 0 (wait forever), so a
      // wedged holder (stalled event loop, paused process, partition after
      // `begin`) would stall every admission on every replica instead of
      // failing closed. Both settings are transaction-local, so the pooled
      // connection returns to its previous settings on commit or rollback.
      await client.query(`select set_config('lock_timeout', $1, true)`, [
        `${this.config.lockTimeoutMs}ms`,
      ])
      await client.query(`select set_config('statement_timeout', $1, true)`, [
        `${this.config.statementTimeoutMs}ms`,
      ])
      await client.query(
        `select pg_advisory_xact_lock(hashtext('legal_hydration_admission'))`,
      )
      // Housekeeping only: the counts below filter on time, so an expired
      // lease or an out-of-window miss is already excluded even before it is
      // swept. Deleting keeps the tables small.
      await client.query(
        `delete from legal_hydration_leases where expires_at <= now()`,
      )
      await client.query(
        `delete from legal_hydration_misses
          where admitted_at <= now() - ($1::bigint * interval '1 millisecond')`,
        [this.config.windowMs],
      )

      const leases = await client.query<{ count: string }>(
        `select count(*)::text as count
           from legal_hydration_leases
          where expires_at > now()`,
      )
      if (Number(leases.rows[0]?.count ?? '0') >= this.config.queueMax) {
        await client.query('rollback')
        return { status: 'budget_exceeded' }
      }

      if (chargeMiss) {
        const misses = await client.query<{ count: string }>(
          `select count(*)::text as count
             from legal_hydration_misses
            where subject = $1
              and admitted_at > now() - ($2::bigint * interval '1 millisecond')`,
          [subject, this.config.windowMs],
        )
        if (Number(misses.rows[0]?.count ?? '0') >= this.config.perClientMax) {
          await client.query('rollback')
          return { status: 'budget_exceeded' }
        }
        await client.query(
          `insert into legal_hydration_misses (subject) values ($1)`,
          [subject],
        )
      }

      await client.query(
        `insert into legal_hydration_leases (id, subject, expires_at)
         values ($1, $2, now() + ($3::bigint * interval '1 millisecond'))`,
        [leaseId, subject, this.config.leaseTtlMs],
      )
      await client.query('commit')
      return { status: 'admitted', leaseId }
    } catch {
      await rollbackQuietly(client)
      // No subject, key, lease or query text is logged: the error names the
      // failure, nothing about the work.
      console.error('Legal hydration admission ledger unavailable')
      return { status: 'unavailable' }
    } finally {
      client.release()
    }
  }

  async complete(leaseId: string): Promise<void> {
    try {
      await this.pool.query(
        `delete from legal_hydration_leases where id = $1`,
        [leaseId],
      )
    } catch {
      // A failed release must not mask the operation's outcome. The lease
      // expires on its own, so an unreachable release cannot hold capacity
      // forever.
      console.error('Legal hydration lease release failed')
    }
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback')
  } catch {
    // The connection is already broken; there is nothing to roll back.
  }
}
