import type { Pool, PoolClient } from 'pg'
import { rollbackQuietly } from './database-transaction'
import type {
  MojRequestBudget,
  MojRequestCharge,
} from '@obiter/legal-source-provider'

export interface PostgresMojRequestBudgetConfig {
  limit: number
  windowMs: number
  connectTimeoutMs: number
  lockTimeoutMs: number
  statementTimeoutMs: number
}

// Legal: Find Case Law material is licensed; operational request rows must not be written into the legal corpus database.
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
      console.error('Find Case Law request budget ledger unavailable')
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
        `select pg_advisory_xact_lock(hashtext('legal_moj_request_budget'))`,
      )
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
      console.error('Find Case Law request budget ledger unavailable')
      return { status: 'unavailable' }
    } finally {
      client.release()
    }
  }
}

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
    void connecting.then((late) => late.release()).catch(() => {})
    return null
  }
  return client
}
