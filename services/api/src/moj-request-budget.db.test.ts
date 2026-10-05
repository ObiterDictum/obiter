import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Pool } from 'pg'
import { PostgresMojRequestBudget } from './moj-request-budget'
import {
  createTestPool,
  requireTestDatabaseUrl,
} from './test-database.test-support'

/**
 * Two independent connection pools stand in for two API replicas sharing one
 * migrated application database. Each has its own budget instance, so no
 * in-process state is shared; only the rows are. This is the cluster boundary
 * the per-process limiter cannot provide.
 *
 * Synthetic charges only, and no provider is reached: a charge is a row, so no
 * external call is made anywhere in this suite.
 */
const poolA = createTestPool()
const poolB = createTestPool()

async function clearCharges() {
  await poolA.query('delete from legal_moj_request_charges')
}

afterAll(async () => {
  await clearCharges()
  await poolA.end()
  await poolB.end()
})

beforeEach(clearCharges)

function budget(
  pool: Pool,
  config: Partial<{
    limit: number
    windowMs: number
    connectTimeoutMs: number
    lockTimeoutMs: number
    statementTimeoutMs: number
  }> = {},
) {
  return new PostgresMojRequestBudget(pool, {
    limit: 5,
    windowMs: 300_000,
    connectTimeoutMs: 5_000,
    lockTimeoutMs: 2_000,
    statementTimeoutMs: 5_000,
    ...config,
  })
}

async function chargeCount(pool: Pool) {
  const result = await pool.query<{ count: string }>(
    'select count(*)::text as count from legal_moj_request_charges',
  )
  return Number(result.rows[0]?.count ?? '0')
}

describe('shared Postgres Find Case Law request budget', () => {
  it('lets exactly one of two processes spend the last slot', async () => {
    const a = budget(poolA, { limit: 1 })
    const b = budget(poolB, { limit: 1 })

    const results = await Promise.all([a.charge(), b.charge()])

    expect(results.filter((r) => r.status === 'allowed')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rate_limited')).toHaveLength(1)
    // Exactly one row was committed: the loser's transaction rolled back.
    expect(await chargeCount(poolA)).toBe(1)
  })

  it('shares one window across two processes', async () => {
    const a = budget(poolA, { limit: 2 })
    const b = budget(poolB, { limit: 2 })

    expect((await a.charge()).status).toBe('allowed')
    expect((await b.charge()).status).toBe('allowed')
    expect((await a.charge()).status).toBe('rate_limited')
  })

  it('reports a retry wait bounded by the oldest in-window charge', async () => {
    const a = budget(poolA, { limit: 1, windowMs: 300_000 })
    expect((await a.charge()).status).toBe('allowed')

    const refused = await a.charge()
    expect(refused.status).toBe('rate_limited')
    if (refused.status !== 'rate_limited') return
    // The oldest charge is seconds old, so the wait is most of the window but
    // never longer than it, and never zero.
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(300)
  })

  it('frees the slot once the window rolls over', async () => {
    const a = budget(poolA, { limit: 1, windowMs: 150 })
    expect((await a.charge()).status).toBe('allowed')
    expect((await a.charge()).status).toBe('rate_limited')

    await new Promise((resolve) => setTimeout(resolve, 350))

    // The out-of-window row is excluded by the count even before the sweep,
    // so the next charge is admitted.
    expect((await a.charge()).status).toBe('allowed')
  })

  it('fails closed within bounds on a wedged budget lock and commits no charge', async () => {
    const short = budget(poolA, {
      limit: 3,
      lockTimeoutMs: 150,
      statementTimeoutMs: 1_000,
    })
    const holder = await poolB.connect()
    try {
      await holder.query('begin')
      await holder.query(
        `select pg_advisory_xact_lock(hashtext('legal_moj_request_budget'))`,
      )

      const started = Date.now()
      const result = await short.charge()
      const elapsed = Date.now() - started

      expect(result.status).toBe('unavailable')
      expect(elapsed).toBeGreaterThanOrEqual(100)
      expect(elapsed).toBeLessThan(1_000)
      expect(await chargeCount(poolA)).toBe(0)
    } finally {
      await holder.query('rollback')
      holder.release()
    }
  })

  it('recovers once the wedged lock holder releases', async () => {
    const short = budget(poolA, {
      lockTimeoutMs: 150,
      statementTimeoutMs: 1_000,
    })
    const holder = await poolB.connect()
    try {
      await holder.query('begin')
      await holder.query(
        `select pg_advisory_xact_lock(hashtext('legal_moj_request_budget'))`,
      )
      expect((await short.charge()).status).toBe('unavailable')
    } finally {
      await holder.query('rollback')
      holder.release()
    }

    expect((await short.charge()).status).toBe('allowed')
  })

  it('fails closed when the budget database is unreachable', async () => {
    const broken = new Pool({
      connectionString: 'postgres://obiter:obiter@127.0.0.1:1/obiter_test',
      connectionTimeoutMillis: 250,
    })
    try {
      expect((await budget(broken).charge()).status).toBe('unavailable')
    } finally {
      await broken.end()
    }
  })

  it('fails closed within bounds when every pooled connection is busy and releases a late client', async () => {
    const exhausted = new Pool({
      connectionString: requireTestDatabaseUrl(),
      max: 1,
    })
    const held = await exhausted.connect()
    try {
      const bounded = budget(exhausted, { connectTimeoutMs: 150 })
      const started = Date.now()
      const result = await bounded.charge()
      const elapsed = Date.now() - started

      expect(result.status).toBe('unavailable')
      expect(elapsed).toBeGreaterThanOrEqual(100)
      expect(elapsed).toBeLessThan(1_000)
    } finally {
      held.release()
    }

    // The connection that arrived after the timeout was released back into
    // the pool, so a later charge is admitted rather than waiting forever.
    const recovered = await budget(exhausted, {
      connectTimeoutMs: 1_000,
    }).charge()
    expect(recovered.status).toBe('allowed')
    await exhausted.end()
  })

  it('stores no URL, query text, subject or identity in a charge row', async () => {
    expect((await budget(poolA).charge()).status).toBe('allowed')

    const columns = await poolA.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'legal_moj_request_charges'
        order by column_name`,
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'charged_at',
      'id',
    ])
  })
})
