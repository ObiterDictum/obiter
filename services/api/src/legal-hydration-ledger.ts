import type { Pool, PoolClient } from 'pg'
import { rollbackQuietly } from './database-transaction'
import type {
  HydrationAdmission,
  LegalHydrationLedger,
} from './legal-search-hydration-budget'

export interface PostgresLegalHydrationLedgerConfig {
  queueMax: number
  perClientMax: number
  windowMs: number
  leaseTtlMs: number
  lockTimeoutMs: number
  statementTimeoutMs: number
}

// Legal: The legal corpus holds licensed source material; hydration ledger rows must live on the application database, never join the corpus.
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
      console.error('Legal hydration admission ledger unavailable')
      return { status: 'unavailable' }
    }

    try {
      await client.query('begin')
      await client.query(`select set_config('lock_timeout', $1, true)`, [
        `${this.config.lockTimeoutMs}ms`,
      ])
      await client.query(`select set_config('statement_timeout', $1, true)`, [
        `${this.config.statementTimeoutMs}ms`,
      ])
      await client.query(
        `select pg_advisory_xact_lock(hashtext('legal_hydration_admission'))`,
      )
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
      console.error('Legal hydration lease release failed')
    }
  }
}
