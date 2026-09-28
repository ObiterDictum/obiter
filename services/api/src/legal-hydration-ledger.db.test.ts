import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Pool } from 'pg'
import {
  ANONYMOUS_HYDRATION_SUBJECT,
  LegalSourceHydrationGate,
} from './legal-search-hydration-budget'
import { PostgresLegalHydrationLedger } from './legal-hydration-ledger'
import { createTestPool } from './test-database.test-support'

/**
 * Two independent connection pools stand in for two API replicas sharing one
 * migrated application database. Each has its own ledger instance, so no
 * in-process state is shared; only the rows are. This is the cluster boundary
 * the per-process gate cannot provide.
 *
 * Synthetic subjects and keys only, and no provider is reached: admitted
 * leases are completed by the test, so no external call is made.
 */
const poolA = createTestPool()
const poolB = createTestPool()

async function clearLedgerState() {
  await poolA.query('delete from legal_hydration_leases')
  await poolA.query('delete from legal_hydration_misses')
}

afterAll(async () => {
  await clearLedgerState()
  await poolA.end()
  await poolB.end()
})

beforeEach(clearLedgerState)

function ledger(
  pool: Pool,
  config: Partial<{
    queueMax: number
    perClientMax: number
    windowMs: number
    leaseTtlMs: number
    lockTimeoutMs: number
    statementTimeoutMs: number
  }> = {},
) {
  return new PostgresLegalHydrationLedger(pool, {
    queueMax: 24,
    perClientMax: 12,
    windowMs: 600_000,
    leaseTtlMs: 60_000,
    lockTimeoutMs: 2_000,
    statementTimeoutMs: 5_000,
    ...config,
  })
}

describe('shared Postgres hydration admission ledger', () => {
  it('admits at most one unexpired lease across two processes', async () => {
    const a = ledger(poolA, { queueMax: 1 })
    const b = ledger(poolB, { queueMax: 1 })

    const results = await Promise.all([
      a.admit('usr_a', 'key-a', true),
      b.admit('usr_b', 'key-b', true),
    ])

    const admitted = results.filter((result) => result.status === 'admitted')
    expect(admitted).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'budget_exceeded'),
    ).toHaveLength(1)

    const leaseId =
      admitted[0]?.status === 'admitted' ? admitted[0].leaseId : ''
    await a.complete(leaseId)
    expect((await b.admit('usr_b', 'key-b', true)).status).toBe('admitted')
  })

  it('shares one per-subject window across two processes', async () => {
    const a = ledger(poolA, { perClientMax: 2 })
    const b = ledger(poolB, { perClientMax: 2 })

    expect((await a.admit('usr_a', 'key-1', true)).status).toBe('admitted')
    expect((await b.admit('usr_a', 'key-2', true)).status).toBe('admitted')
    expect((await a.admit('usr_a', 'key-3', true)).status).toBe(
      'budget_exceeded',
    )
  })

  it('charges a repeated canonical key rather than deduplicating across processes', async () => {
    const a = ledger(poolA, { perClientMax: 1 })
    const b = ledger(poolB, { perClientMax: 1 })

    const first = await a.admit('usr_a', 'same-key', true)
    expect(first.status).toBe('admitted')
    if (first.status === 'admitted') await a.complete(first.leaseId)

    // No cross-replica deduplication is promised: the second replica charges
    // its own miss for the same canonical key and is refused by the window.
    expect((await b.admit('usr_a', 'same-key', true)).status).toBe(
      'budget_exceeded',
    )
  })

  it('charges one anonymous bucket across two processes', async () => {
    const a = ledger(poolA, { perClientMax: 1 })
    const b = ledger(poolB, { perClientMax: 1 })

    const anonymous = await a.admit(ANONYMOUS_HYDRATION_SUBJECT, 'doc-1', true)
    expect(anonymous.status).toBe('admitted')
    if (anonymous.status === 'admitted') await a.complete(anonymous.leaseId)

    expect(
      (await b.admit(ANONYMOUS_HYDRATION_SUBJECT, 'doc-2', true)).status,
    ).toBe('budget_exceeded')
    // A real session id draws a separate window, so the sentinel cannot merge
    // with a user and a caller cannot mint it from an id.
    expect((await a.admit('usr_real', 'doc-3', true)).status).toBe('admitted')
  })

  it('does not charge the miss window for downstream work but still bounds it', async () => {
    const a = ledger(poolA, { perClientMax: 1, queueMax: 1 })

    const request = await a.admit('usr_a', 'query', true)
    expect(request.status).toBe('admitted')

    // The charged request still holds the only in-flight slot.
    expect((await a.admit('usr_a', 'detail', false)).status).toBe(
      'budget_exceeded',
    )
    if (request.status === 'admitted') await a.complete(request.leaseId)

    // With the slot free, downstream work takes a lease without a new miss.
    const detail = await a.admit('usr_a', 'detail', false)
    expect(detail.status).toBe('admitted')
    if (detail.status === 'admitted') await a.complete(detail.leaseId)

    // The window still holds exactly the one charged miss.
    expect((await a.admit('usr_a', 'query-2', true)).status).toBe(
      'budget_exceeded',
    )
  })

  it('bounds unexpired leases, not operations that outlive their lease', async () => {
    const a = ledger(poolA, { queueMax: 1, leaseTtlMs: 150 })
    const b = ledger(poolB, { queueMax: 1, leaseTtlMs: 150, perClientMax: 100 })

    // Process A is admitted and keeps running without completing. Its lease
    // does not renew, exactly as a crashed replica's would not.
    expect((await a.admit('usr_a', 'key-a', true)).status).toBe('admitted')
    expect((await b.admit('usr_b', 'key-b', true)).status).toBe(
      'budget_exceeded',
    )

    await new Promise((resolve) => setTimeout(resolve, 350))
    // The lease expired while A's operation still runs, so B is admitted. The
    // ledger bounds unexpired leases, not every still-running operation; this
    // pins the recorded limit so no claim can widen it by accident.
    expect((await b.admit('usr_b', 'key-b', true)).status).toBe('admitted')
  })

  it('bounds the wait on a wedged admission lock and commits no admission', async () => {
    const short = ledger(poolA, {
      lockTimeoutMs: 150,
      statementTimeoutMs: 1_000,
    })
    const holder = await poolB.connect()
    try {
      await holder.query('begin')
      await holder.query(
        `select pg_advisory_xact_lock(hashtext('legal_hydration_admission'))`,
      )

      const started = Date.now()
      const result = await short.admit('usr_a', 'key-a', true)
      const elapsed = Date.now() - started

      expect(result.status).toBe('unavailable')
      // Bounded by the configured 150ms lock timeout, not by the holder.
      expect(elapsed).toBeGreaterThanOrEqual(100)
      expect(elapsed).toBeLessThan(1_000)
      // A timed-out admission rolled back: it commits neither a lease nor a
      // charged miss.
      const leases = await poolA.query<{ count: string }>(
        'select count(*)::text as count from legal_hydration_leases',
      )
      const misses = await poolA.query<{ count: string }>(
        'select count(*)::text as count from legal_hydration_misses',
      )
      expect(Number(leases.rows[0]?.count ?? '0')).toBe(0)
      expect(Number(misses.rows[0]?.count ?? '0')).toBe(0)
    } finally {
      await holder.query('rollback')
      holder.release()
    }
  })

  it('recovers admission once the wedged lock holder releases', async () => {
    const short = ledger(poolA, {
      lockTimeoutMs: 150,
      statementTimeoutMs: 1_000,
    })
    const holder = await poolB.connect()
    try {
      await holder.query('begin')
      await holder.query(
        `select pg_advisory_xact_lock(hashtext('legal_hydration_admission'))`,
      )
      expect((await short.admit('usr_a', 'key-a', true)).status).toBe(
        'unavailable',
      )
    } finally {
      await holder.query('rollback')
      holder.release()
    }

    // With the lock free, admission succeeds again: the timeout is a bound on
    // waiting, not a latch that disables the ledger.
    const recovered = await short.admit('usr_a', 'key-a', true)
    expect(recovered.status).toBe('admitted')
    if (recovered.status === 'admitted') {
      await short.complete(recovered.leaseId)
    }
  })

  it('fails closed when the admission database is unreachable', async () => {
    const broken = new Pool({
      connectionString: 'postgres://obiter:obiter@127.0.0.1:1/obiter_test',
      connectionTimeoutMillis: 250,
    })
    try {
      const unreachable = ledger(broken)
      expect((await unreachable.admit('usr_a', 'key', true)).status).toBe(
        'unavailable',
      )
      // Releasing a lease against an unreachable database reports nothing and
      // never throws; the lease expires on its own.
      await unreachable.complete('00000000-0000-0000-0000-000000000000')
    } finally {
      await broken.end()
    }
  })

  it('does not invoke an operation when admission is unavailable', async () => {
    const broken = new Pool({
      connectionString: 'postgres://obiter:obiter@127.0.0.1:1/obiter_test',
      connectionTimeoutMillis: 250,
    })
    try {
      const gate = new LegalSourceHydrationGate(ledger(broken))
      let providerReached = false
      const result = await gate.run('usr_a', 'key', async () => {
        providerReached = true
        return 'should not run'
      })

      expect(result).toEqual({ status: 'unavailable' })
      expect(providerReached).toBe(false)
    } finally {
      await broken.end()
    }
  })

  it('does not invoke an operation when the shared window is exhausted', async () => {
    const gateA = new LegalSourceHydrationGate(
      ledger(poolA, { perClientMax: 1 }),
    )
    const gateB = new LegalSourceHydrationGate(
      ledger(poolB, { perClientMax: 1 }),
    )
    let providerCalls = 0
    let corpusWrites = 0

    const first = await gateA.run('usr_a', 'alpha', async () => {
      providerCalls += 1
      corpusWrites += 1
      return 'ok'
    })
    expect(first.status).toBe('ok')

    // A second process with the same subject is refused by the shared window
    // before its operation runs, so it reaches neither the provider nor the
    // corpus.
    const rejected = await gateB.run('usr_a', 'beta', async () => {
      providerCalls += 1
      corpusWrites += 1
      return 'ok'
    })
    expect(rejected).toEqual({ status: 'budget_exceeded' })
    expect(providerCalls).toBe(1)
    expect(corpusWrites).toBe(1)
  })
})
