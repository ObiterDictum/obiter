import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../../scripts/test/vitest-compat'
import { Hono } from 'hono'

import type { ApiEnv } from '../../../env'
import { LegalSearchHydrationBudget } from '../../../legal-search-hydration-budget'
import { createTestApiEnv } from '../../../test-api-env'

// P0. banner: every product route that can reach Find Case Law must charge the
// same per-user hydration budget, and a rejected request must not dispatch an
// upstream fetch, write the corpus, or enqueue background work.
//
// The harness mocks the search engine so stored search always misses and the
// provider `fetch` boundary is observable. Counts are asserted on the provider
// `fetch` calls, not on internal helpers.

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

function probeApp(
  budget: LegalSearchHydrationBudget,
  user: { id: string } | null,
  options: Parameters<typeof createLegalSearchProxyRoutes>[2] = {},
) {
  const sourceStore = createInMemoryLegalAuthoritySourceStore()
  const proxy = createLegalSearchProxyRoutes(env, sourceStore, {
    corpusWrites: sourceStore,
    hydrationBudget: budget,
    ...options,
  })
  const app = new Hono<{
    Variables: { requestId: string; user: { id: string } | null }
  }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_test')
    c.set('user', user)
    await next()
  })
  app.route('/', proxy)
  return { app, sourceStore }
}

function budget(
  config: Partial<
    ConstructorParameters<typeof LegalSearchHydrationBudget>[0]
  > = {},
) {
  return new LegalSearchHydrationBudget({
    queueMax: 24,
    perClientMax: 12,
    windowMs: 600_000,
    ...config,
  })
}

function emptyStoredSearch() {
  searchClientMock.search.mockResolvedValue({
    hits: [],
    query: 'query',
    estimatedTotalHits: 0,
    processingTimeMs: 1,
  })
}

function summaryFeed(entries = '') {
  return new Response(`<feed>${entries}</feed>`)
}

/** `mockImplementation` needs the full `typeof fetch` shape; the handler is
 * only ever called with the upstream URL. */
function asFetch(handler: () => Promise<Response> | Response) {
  return handler as unknown as typeof fetch
}

const documentIdA = 'ewhc-admin-2026-1246'
const documentIdB = 'ewhc-admin-2026-1247'
const detailHtml =
  '<html><body><h1>Secretary of State for the Home Department v Miah</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>The court considered the administrative law challenge and the evidence before the Secretary of State.</p></article></body></html>'

function fetchSearchRequest(query: string, foregroundLiveResults: boolean) {
  return {
    method: 'POST' as const,
    body: JSON.stringify({ query, court: 'uksc', foregroundLiveResults }),
    headers: { 'content-type': 'application/json' },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  searchClientMock.search.mockReset()
  searchClientMock.indexDocuments.mockReset()
  searchClientMock.getDocument.mockReset()
  searchClientMock.index.mockReset()
  emptyStoredSearch()
})

describe('hydration budget shared boundary', () => {
  it('charges foreground live results to the same per-user budget', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(asFetch(async () => summaryFeed()))
    const { app } = probeApp(budget({ perClientMax: 1 }), { id: 'usr_a' })

    const first = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('alpha', true),
    )
    expect(first.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('beta', true),
    )
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({
      error: { code: 'hydration_budget_exceeded' },
    })
    // The rejected request must not have dispatched an upstream fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('charges the read-only foreground fallback to the budget too', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(asFetch(async () => summaryFeed()))
    const { app } = probeApp(
      budget({ perClientMax: 1 }),
      { id: 'usr_a' },
      {
        corpusWrites: null,
      },
    )

    const first = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('alpha', false),
    )
    expect(first.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await first.json()).toMatchObject({
      diagnostics: { liveResultsNotPersisted: true },
    })

    const second = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('beta', false),
    )
    expect(second.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects foreground live when the in-flight queue is saturated', async () => {
    const sharedBudget = budget()
    for (let index = 0; index < 24; index += 1) {
      sharedBudget.tryBeginHydration('usr_a', `prefilled-${index}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { app } = probeApp(sharedBudget, { id: 'usr_a' })

    const response = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('saturated', true),
    )

    expect(response.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates equivalent foreground query variants into one upstream fetch', async () => {
    let signalFirstFetch: (() => void) | undefined
    const firstFetch = new Promise<void>((resolve) => {
      signalFirstFetch = resolve
    })
    let releaseProvider: ((value: Response) => void) | undefined
    const providerGate = new Promise<Response>((resolve) => {
      releaseProvider = resolve
    })
    let fetchCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () => {
        fetchCount += 1
        signalFirstFetch?.()
        return providerGate
      }),
    )
    // The second equivalent request waits until the first is in flight, so the
    // join is deterministic rather than racing a timer.
    let searchCount = 0
    const empty = {
      hits: [],
      query: 'query',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    }
    searchClientMock.search.mockImplementation(async () => {
      searchCount += 1
      if (searchCount === 2) await firstFetch
      return empty
    })
    const { app } = probeApp(budget(), { id: 'usr_a' })

    const first = app.request(
      '/api/search/fetch',
      fetchSearchRequest('Potanina', true),
    )
    const second = app.request(
      '/api/search/fetch',
      fetchSearchRequest('  potanina  ', true),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseProvider?.(summaryFeed())
    const [firstResponse, secondResponse] = await Promise.all([first, second])

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(fetchCount).toBe(1)
  })

  it('does not permanently hold an in-flight slot after an upstream error', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(asFetch(async () => summaryFeed()))
    const { app } = probeApp(budget(), { id: 'usr_a' })

    const first = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('alpha', true),
    )
    expect(first.status).toBe(503)

    const second = await app.request(
      '/api/search/fetch',
      fetchSearchRequest('alpha', true),
    )
    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives different users independent windows', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(asFetch(async () => summaryFeed()))
    const sharedBudget = budget({ perClientMax: 1 })
    const { app: appA } = probeApp(sharedBudget, { id: 'usr_a' })
    const { app: appB } = probeApp(sharedBudget, { id: 'usr_b' })

    expect(
      (
        await appA.request(
          '/api/search/fetch',
          fetchSearchRequest('alpha', true),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await appB.request(
          '/api/search/fetch',
          fetchSearchRequest('beta', true),
        )
      ).status,
    ).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('charges authenticated document-detail misses to the budget', async () => {
    searchClientMock.getDocument.mockRejectedValue(new Error('not found'))
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(asFetch(async () => new Response(detailHtml)))
    const { app } = probeApp(budget({ perClientMax: 1 }), { id: 'usr_a' })

    const first = await app.request(`/api/search/documents/${documentIdA}`)
    expect(first.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await app.request(`/api/search/documents/${documentIdB}`)
    expect(second.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch or persist a document for an anonymous caller', async () => {
    searchClientMock.getDocument.mockRejectedValue(new Error('not found'))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { app, sourceStore } = probeApp(budget(), null)
    const upsertDocument = vi.spyOn(sourceStore, 'upsertDocument')

    const response = await app.request(`/api/search/documents/${documentIdA}`)

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertDocument).not.toHaveBeenCalled()
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('does not write the corpus when the document budget rejects', async () => {
    searchClientMock.getDocument.mockRejectedValue(new Error('not found'))
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(asFetch(async () => new Response(detailHtml)))
    const { app, sourceStore } = probeApp(budget({ perClientMax: 0 }), {
      id: 'usr_a',
    })
    const upsertDocument = vi.spyOn(sourceStore, 'upsertDocument')

    const response = await app.request(`/api/search/documents/${documentIdA}`)

    expect(response.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(upsertDocument).not.toHaveBeenCalled()
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })
})
