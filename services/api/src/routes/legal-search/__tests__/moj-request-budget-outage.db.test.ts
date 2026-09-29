import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../../scripts/test/vitest-compat'
import { Hono } from 'hono'
import { Pool } from 'pg'

import type { ApiEnv } from '../../../env'
import { PostgresMojRequestBudget } from '../../../moj-request-budget'
import { createTestApiEnv } from '../../../test-api-env'
import { createTestPool } from '../../../test-database.test-support'

// The cluster-wide Find Case Law request budget lives on the application
// database. When that database is unreachable, or its lock is wedged, a
// provider-reaching request must fail closed with no upstream HTTP attempt at
// all: an uncharged request cannot be shown to be inside the shared allowance.

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  indexDocuments: vi.fn(),
  getDocument: vi.fn(),
  search: vi.fn(),
  index: vi.fn(),
}))

const obiterSearchClientModule = { ...(await import('@obiter/search-client')) }
const obiterSearchClientModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/search-client')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@obiter/search-client', () =>
  Object.assign(
    { ...obiterSearchClientModuleKeys },
    (() => ({
      ...obiterSearchClientModule,
      ...searchClientMock,
    }))(),
  ),
)

const { createLegalSearchProxyRoutes } = await import('../proxy-routes')
const { createInMemoryLegalAuthoritySourceStore } =
  await import('../source-store')

const env: ApiEnv = createTestApiEnv()

const unavailablePool = new Pool({
  connectionString: 'postgres://obiter:obiter@127.0.0.1:1/obiter_test',
  connectionTimeoutMillis: 250,
})

afterAll(async () => {
  await unavailablePool.end()
})

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  searchClientMock.getDocument.mockReset()
  searchClientMock.search.mockReset()
  searchClientMock.indexDocuments.mockReset()
})

const missingDocumentId = 'ewhc-admin-2026-9999'

function probeApp(
  budget: PostgresMojRequestBudget,
  pool: Pool,
  user: { id: string } | null = null,
) {
  const store = createInMemoryLegalAuthoritySourceStore()
  const proxy = createLegalSearchProxyRoutes(env, store, {
    corpusWrites: store,
    mojRequestBudget: budget,
  })
  const app = new Hono<{
    Variables: { requestId: string; user: { id: string } | null }
  }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_test')
    // Anonymous still reaches the provider on a document-detail miss.
    c.set('user', user)
    await next()
  })
  app.route('/', proxy)
  // Keeps the pool alive for the lifetime of the probe.
  void pool
  return { app }
}

describe('shared Find Case Law request budget outage', () => {
  it('refuses a provider-fetching detail miss with no upstream call when the budget database is down', async () => {
    searchClientMock.getDocument.mockResolvedValue(null)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no provider call expected'))
    const budget = new PostgresMojRequestBudget(unavailablePool, {
      limit: 1000,
      windowMs: 300_000,
      connectTimeoutMs: 5_000,
      lockTimeoutMs: 2_000,
      statementTimeoutMs: 5_000,
    })
    const { app } = probeApp(budget, unavailablePool)

    const response = await app.request(
      `/api/search/documents/${missingDocumentId}`,
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a detail miss with no upstream call while the budget lock is wedged', async () => {
    const pool = createTestPool()
    const holderPool = createTestPool()
    const holder = await holderPool.connect()
    try {
      await holder.query('begin')
      await holder.query(
        `select pg_advisory_xact_lock(hashtext('legal_moj_request_budget'))`,
      )
      searchClientMock.getDocument.mockResolvedValue(null)
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('no provider call expected'))
      const budget = new PostgresMojRequestBudget(pool, {
        limit: 1000,
        windowMs: 300_000,
        connectTimeoutMs: 5_000,
        lockTimeoutMs: 150,
        statementTimeoutMs: 1_000,
      })
      const { app } = probeApp(budget, pool)

      const response = await app.request(
        `/api/search/documents/${missingDocumentId}`,
      )

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: { code: 'storage_unavailable' },
      })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await holder.query('rollback')
      holder.release()
      await holderPool.end()
      await pool.end()
    }
  })

  it('makes no upstream attempt when the budget is down on the queued background path', async () => {
    searchClientMock.getDocument.mockResolvedValue(null)
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'some query',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no provider call expected'))
    const budget = new PostgresMojRequestBudget(unavailablePool, {
      limit: 1000,
      windowMs: 300_000,
      connectTimeoutMs: 5_000,
      lockTimeoutMs: 2_000,
      statementTimeoutMs: 5_000,
    })
    const { app } = probeApp(budget, unavailablePool, { id: 'usr_test' })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'some query',
        foregroundLiveResults: false,
      }),
      headers: { 'content-type': 'application/json' },
    })

    // Queued background hydration is best effort: the budget it cannot charge
    // makes no upstream attempt and the transport outcome stays queued,
    // exactly as a provider outage degrades to the stored result. Foreground
    // and document-detail paths answer 503 instead.
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ hydrationQueued: true })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('admits exactly one upstream attempt across two replica apps on the last slot', async () => {
    const poolA = createTestPool()
    const poolB = createTestPool()
    try {
      for (const pool of [poolA, poolB]) {
        await pool.query('delete from legal_moj_request_charges')
      }
      searchClientMock.getDocument.mockResolvedValue(null)
      const fetchMock = vi.fn(async () => new Response('gone', { status: 404 }))
      vi.stubGlobal('fetch', fetchMock)

      const config = {
        limit: 1,
        windowMs: 300_000,
        connectTimeoutMs: 5_000,
        lockTimeoutMs: 2_000,
        statementTimeoutMs: 5_000,
      }
      const replicaA = probeApp(
        new PostgresMojRequestBudget(poolA, config),
        poolA,
      )
      const replicaB = probeApp(
        new PostgresMojRequestBudget(poolB, config),
        poolB,
      )

      const responses = await Promise.all([
        replicaA.app.request('/api/search/documents/ewhc-admin-2026-1'),
        replicaB.app.request('/api/search/documents/ewhc-admin-2026-2'),
      ])
      const statuses = responses.map((response) => response.status).sort()

      // One replica spent the only slot; the other was refused before it
      // reached the provider, so exactly one upstream attempt was made.
      expect(statuses).toEqual([404, 503])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      await poolA.query('delete from legal_moj_request_charges')
      await poolA.end()
      await poolB.end()
    }
  })
})
