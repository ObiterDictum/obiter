import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../../scripts/test/vitest-compat'
import { Hono } from 'hono'
import { Pool } from 'pg'

import type { ApiEnv } from '../../../env'
import { PostgresLegalHydrationLedger } from '../../../legal-hydration-ledger'
import { createTestApiEnv } from '../../../test-api-env'

// The admission ledger now lives on the application database. When that
// database is unreachable, a new provider hydration must fail closed, but a
// document already stored in the corpus must still be served: stored reads run
// on the corpus pool and never cross the admission boundary.

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

// A pool pointed at a closed port is a real database outage with a bounded
// connect timeout, not a stubbed error shape.
const unavailablePool = new Pool({
  connectionString: 'postgres://obiter:obiter@127.0.0.1:1/obiter_test',
  connectionTimeoutMillis: 250,
})

afterAll(async () => {
  await unavailablePool.end()
})

beforeEach(() => {
  vi.restoreAllMocks()
  searchClientMock.getDocument.mockReset()
  searchClientMock.search.mockReset()
  searchClientMock.indexDocuments.mockReset()
})

const storedDocumentId = 'ewhc-admin-2026-1246'
const missingDocumentId = 'ewhc-admin-2026-9999'

const storedDocument = {
  id: storedDocumentId,
  title: 'Secretary of State for the Home Department v Miah',
  neutralCitation: '[2026] EWHC 1246 (Admin)',
  court: 'ewhc/admin',
  jurisdiction: 'england-and-wales',
  dateDecided: '2026-05-22',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1246',
  paragraphs: [],
}

const storedProvider = {
  documentUri: 'https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1246',
  sourceUri: 'https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1246',
  xmlUri: null,
  pdfUri: null,
  contentHash: 'synthetic-hash',
  rawAtomEntry: '',
}

function probeApp(
  store: ReturnType<typeof createInMemoryLegalAuthoritySourceStore>,
) {
  const ledger = new PostgresLegalHydrationLedger(unavailablePool, {
    queueMax: 24,
    perClientMax: 12,
    windowMs: 600_000,
    leaseTtlMs: 60_000,
  })
  const proxy = createLegalSearchProxyRoutes(env, store, {
    corpusWrites: store,
    hydrationBudget: ledger,
  })
  const app = new Hono<{
    Variables: { requestId: string; user: { id: string } | null }
  }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_test')
    c.set('user', null)
    await next()
  })
  app.route('/', proxy)
  return { app }
}

describe('hydration admission outage', () => {
  it('serves an already-stored document without touching the ledger', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()
    await store.upsertDocument(storedDocument, storedProvider)
    searchClientMock.getDocument.mockResolvedValue(null)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no provider call expected'))
    const { app } = probeApp(store)

    const response = await app.request(
      `/api/search/documents/${storedDocumentId}`,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: { id: storedDocumentId },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a new hydration with no provider call when the ledger is down', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()
    searchClientMock.getDocument.mockResolvedValue(null)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no provider call expected'))
    const { app } = probeApp(store)

    const response = await app.request(
      `/api/search/documents/${missingDocumentId}`,
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
