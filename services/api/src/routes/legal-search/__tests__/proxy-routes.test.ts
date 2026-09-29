import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../../scripts/test/vitest-compat'
import { Hono } from 'hono'

import type { ApiEnv } from '../../../env'
import { createTestApiEnv } from '../../../test-api-env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  indexDocuments: vi.fn(),
  getDocument: vi.fn(),
  search: vi.fn(),
  index: vi.fn(),
}))

const legislationServeMock = vi.hoisted(() => ({
  resolveLegislationFetch: vi.fn(),
  /** The real serve function, so a route-level test can exercise the true
   * classification instead of a hand-written verdict object. */
  actual:
    null as unknown as (typeof import('../legislation-serve'))['resolveLegislationFetch'],
}))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const obiterSearchClientModule = { ...(await import('@obiter/search-client')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
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

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const legislationServeModule = { ...(await import('../legislation-serve')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const legislationServeModuleKeys = Object.fromEntries(
  Object.keys(await import('../legislation-serve')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../legislation-serve', () =>
  Object.assign(
    { ...legislationServeModuleKeys },
    (() => {
      const actual = legislationServeModule
      legislationServeMock.actual = actual.resolveLegislationFetch
      return {
        ...actual,
        resolveLegislationFetch: legislationServeMock.resolveLegislationFetch,
      }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const {
  createLegalSearchProxyRoutes,
  parseFindCaseLawAtom,
  parseJudgmentParagraphs,
} = await import('../proxy-routes')
import type { LegalAuthoritySourceStore } from '../source-store'
const { createInMemoryLegalAuthoritySourceStore } =
  await import('../source-store')

const env: ApiEnv = createTestApiEnv()

function createAuthenticatedProxyApp(
  sourceStore: LegalAuthoritySourceStore = createInMemoryLegalAuthoritySourceStore(),
  options?: Parameters<typeof createLegalSearchProxyRoutes>[2],
  user: { id: string } | null = { id: 'usr_test' },
  routeEnv: ApiEnv = env,
) {
  const proxy = createLegalSearchProxyRoutes(routeEnv, sourceStore, {
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
  return app
}

const hit = {
  id: 'uksc-2024-3',
  title: 'Potanina v Potanin',
  neutralCitation: '[2024] UKSC 3',
  court: 'uksc',
  jurisdiction: 'england-and-wales',
  dateDecided: '2024-01-31',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
}

// Each test asserts on its own upstream calls. Without this, the module-scope
// spies accumulate calls across tests and a `not.toHaveBeenCalled()` becomes an
// ordering accident rather than a statement about the route.
beforeEach(() => {
  searchClientMock.search.mockReset()
  searchClientMock.getDocument.mockReset()
  searchClientMock.indexDocuments.mockReset()
  searchClientMock.createClient.mockReset()
  searchClientMock.createClient.mockImplementation(() => ({
    id: 'meili-client',
  }))
  searchClientMock.index.mockReset()
  legislationServeMock.resolveLegislationFetch.mockReset()
})

describe('createLegalSearchProxyRoutes', () => {
  it('keeps the judgment half when the legislation half rejects', async () => {
    // The two corpora are federated so each fails independently. A rejection
    // from the legislation half must not reject the Promise.all and lose the
    // judgment results with it.
    legislationServeMock.resolveLegislationFetch.mockRejectedValueOnce(
      new Error('legislation half exploded'),
    )
    searchClientMock.search.mockResolvedValueOnce({
      hits: [{ ...hit }],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { hits: Array<{ id: string }> }
    expect(body.hits.map((entry) => entry.id)).toContain(hit.id)
  })

  it('returns cached results without calling Find Case Law', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [
        {
          ...hit,
          paragraphs: [
            {
              id: 'uksc-2024-3-p1',
              documentId: 'uksc-2024-3',
              paragraphNumber: 1,
              text: 'The application for permission to bring proceedings under Part III is allowed.',
            },
          ],
        },
      ],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      hits: Array<Record<string, unknown>>
    }
    expect(body).toMatchObject({
      cached: true,
      outcome: 'results',
      diagnostics: {
        storedIndexSearched: true,
        liveProviderSearched: false,
      },
      hits: [
        {
          ...hit,
          canonicalUrl: '/case/potanina-v-potanin-2024-uksc-3',
          evidenceIds: ['uksc-2024-3:judgment_paragraph:1'],
          matchReason: 'title_match',
          retrievalPath: 'stored_index',
          retrievalRank: 1,
          retrievalScore: 0.8,
          snippets: [],
        },
      ],
      indexedCount: 0,
    })
    expect(body.hits[0]).not.toHaveProperty('paragraphs')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs bounded filter-only stored court browse without calling Find Case Law', async () => {
    const browseHits = Array.from({ length: 12 }, (_, index) => ({
      ...hit,
      id: `uksc-2024-${index + 1}`,
      title: `Stored UKSC case ${index + 1}`,
      dateDecided: `2024-01-${String(31 - index).padStart(2, '0')}`,
    }))
    searchClientMock.search.mockResolvedValueOnce({
      hits: browseHits,
      query: '',
      estimatedTotalHits: browseHits.length,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '',
        court: 'uksc',
        foregroundLiveResults: false,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { hits: Array<{ id: string }> }
    expect(body).toMatchObject({
      cached: true,
      outcome: 'results',
    })
    expect(body.hits.map((browseHit) => browseHit.id)).toEqual(
      browseHits.slice(0, 10).map((browseHit) => browseHit.id),
    )
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      '',
      { court: 'uksc', sourceType: 'judgment' },
      { includeSnippets: false, includeParagraphs: true, limit: 10 },
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an exact neutral-citation hit from stored index before broad keyword matches', async () => {
    const newerPartial = {
      ...hit,
      id: 'uksc-2026-10',
      title: 'Later judgment discussing [2024] UKSC 3',
      neutralCitation: '[2026] UKSC 10',
      dateDecided: '2026-01-01',
    }
    const exactCitation = {
      ...hit,
      id: 'uksc-2024-3',
      neutralCitation: '[2024] UKSC 3',
      dateDecided: '2024-01-31',
    }
    searchClientMock.search.mockResolvedValueOnce({
      hits: [newerPartial, exactCitation],
      query: '[2024] UKSC 3',
      estimatedTotalHits: 2,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2024] UKSC 3', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: true,
      citation: { recognised: true, status: 'held_exact' },
      diagnostics: {
        exactLookupSearched: true,
        storedIndexSearched: true,
        liveProviderSearched: false,
        citationRecognised: true,
        citationStatus: 'held_exact',
      },
      hits: [
        {
          id: 'uksc-2024-3',
          matchReason: 'exact_neutral_citation',
          citationMatch: 'exact',
          retrievalPath: 'stored_exact_lookup',
          retrievalRank: 1,
        },
      ],
    })
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      '[2024] UKSC 3',
      { court: 'uksc', sourceType: 'judgment' },
      {
        includeSnippets: false,
        includeParagraphs: true,
        limit: 5,
        exactPhrase: '[2024] UKSC 3',
      },
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns recognised_not_held for an absent citation instead of keyword neighbours', async () => {
    // Before the honesty gate this served body_text_match neighbours as
    // `results`; the citation is absent, so the honest answer is empty.
    const neighbours = [
      {
        ...hit,
        id: 'ewca-civ-2023-1482',
        title: 'Neighbour v Neighbour',
        neutralCitation: '[2023] EWCA Civ 1482',
        court: 'ewca-civ',
        dateDecided: '2023-06-01',
        sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2023/1482',
      },
      {
        ...hit,
        id: 'ewca-civ-2024-262',
        title: 'Other v Other',
        neutralCitation: '[2024] EWCA Civ 262',
        court: 'ewca-civ',
        dateDecided: '2024-03-01',
        sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2024/262',
      },
    ]
    searchClientMock.search.mockResolvedValue({
      hits: neighbours,
      query: '[2023] EWCA Civ 123',
      estimatedTotalHits: neighbours.length,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(undefined, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2023] EWCA Civ 123' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        exactLookupSearched: true,
        storedIndexSearched: true,
        liveProviderSearched: false,
        citationRecognised: true,
        citationStatus: 'not_held',
      },
    })
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      '[2023] EWCA Civ 123',
      expect.objectContaining({ sourceType: 'judgment' }),
      expect.objectContaining({ exactPhrase: '[2023] EWCA Civ 123' }),
    )
    // Anonymous stays stored-only: no live call, honest empty instead.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names an unheld Act in diagnostics instead of a judgment citation', async () => {
    // The legislation half recognised the Act and held nothing: the response
    // must carry a not-held verdict, not just a free-text note that an outage
    // could also set.
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: true,
      note: 'Children Act 1989 is not held.',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Children Act 1989',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(
      undefined,
      {
        legislation: {
          pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
          indexName: 'legislation_provisions',
        },
      },
      null,
    )

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Children Act 1989' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        legislationNotHeld: true,
        legislationNote: 'Children Act 1989 is not held.',
        legislationGroupServed: false,
      },
    })
  })

  it('keywords an unheld Act named in prose, in both casings, with no verdict', async () => {
    // L35 through the route, against the real serve classification rather than
    // a hand-written verdict object. The sentence-initial form must reach the
    // same keyword path as its lowercase twin: the legislation group is
    // served and no title-unresolved or not-held diagnostic is emitted.
    legislationServeMock.resolveLegislationFetch.mockImplementation(
      legislationServeMock.actual,
    )
    const directoryActs = [
      {
        identity: 'ukpga/2010/15',
        actType: 'ukpga',
        year: 2010,
        number: 15,
        title: 'Equality Act 2010',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
        extent: 'E+W+S',
      },
      {
        identity: 'ukpga/2023/42',
        actType: 'ukpga',
        year: 2023,
        number: 42,
        title: 'Powers of Attorney Act 2023',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2023/42',
        extent: 'E+W',
      },
      {
        identity: 'ukpga/2022/32',
        actType: 'ukpga',
        year: 2022,
        number: 32,
        title: 'Police, Crime, Sentencing and Courts Act 2022',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2022/32',
        extent: 'E+W',
      },
    ]
    const provisionHit = {
      id: 'ukpga/2026/21/section/12',
      provisionRef: 'ukpga/2026/21/section/12',
      documentIdentity: 'ukpga/2026/21',
      labelPath: 'section/12',
      label: 's. 12',
      title: "Children's Wellbeing and Schools Act 2026",
      year: 2026,
      extent: 'E+W',
      text: 'A provision that shares a word with the title.',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2026/21/section/12',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
    }
    searchClientMock.index.mockReturnValue({
      search: vi.fn(async () => ({
        hits: [provisionHit],
        query: '',
        estimatedTotalHits: 1,
        processingTimeMs: 1,
      })),
    })
    // A variable, not a fresh literal: the real serve reads `.index()` off the
    // client, while the default mock client deliberately carries only an id.
    const provisionSearchClient = {
      id: 'meili-client',
      index: searchClientMock.index,
    }
    searchClientMock.createClient.mockReturnValue(provisionSearchClient)
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: {
          query: vi.fn(async (text: string) =>
            text.includes('from legislation_documents')
              ? { rows: directoryActs }
              : { rows: [] },
          ),
        } as never,
        indexName: 'legislation_provisions',
      },
    })

    for (const query of [
      'Defences under Children Act 1989',
      'defences under Children Act 1989',
    ]) {
      const response = await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({ query }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        outcome: string
        diagnostics: Record<string, unknown>
      }
      // The verdict-free prose path leaves the transport outcome to the
      // judgment half, but the legislation keyword group is served and no
      // title-unresolved or not-held diagnostic is emitted.
      expect(body.diagnostics.legislationGroupServed).toBe(true)
      expect(body.diagnostics.legislationSearchParameters).toBeTruthy()
      expect(body.diagnostics.legislationTitleUnresolved).toBeUndefined()
      expect(body.diagnostics.legislationNotHeld).toBeUndefined()
    }
  })

  it('keeps an unresolved legislation title on the anonymous stored-only branch', async () => {
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: true,
      ambiguous: false,
      note: 'No exact legislation title match was found for "Children Act 1989".',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Children Act 1989',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(
      undefined,
      {
        legislation: {
          pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
          indexName: 'legislation_provisions',
        },
      },
      null,
    )

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Children Act 1989' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'legislation_title_unresolved',
      diagnostics: { legislationTitleUnresolved: true },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves stored citing cases to anonymous callers, labelled not_held', async () => {
    // [2003] UKHL 1 is recognised but not held; the stored citing cases
    // must serve clearly distinguished instead of being discarded.
    const citing = {
      ...hit,
      id: 'ewca-civ-2005-420',
      title: 'Later judgment applying [2003] UKHL 1',
      neutralCitation: '[2005] EWCA Civ 420',
      court: 'ewca-civ',
      dateDecided: '2005-04-01',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2005/420',
      paragraphs: [
        {
          id: 'ewca-civ-2005-420-p1',
          documentId: 'ewca-civ-2005-420',
          paragraphNumber: 1,
          text: 'As held in [2003] UKHL 1, the statutory test applies here at length.',
        },
      ],
    }
    searchClientMock.search.mockResolvedValue({
      hits: [citing],
      query: '[2003] UKHL 1',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(undefined, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2003] UKHL 1' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        exactLookupSearched: true,
        storedIndexSearched: true,
        liveProviderSearched: false,
        citationRecognised: true,
        citationStatus: 'not_held',
      },
      hits: [
        {
          id: 'ewca-civ-2005-420',
          citationMatch: 'citing',
          retrievalPath: 'stored_index',
          retrievalRank: 1,
        },
      ],
    })
    // Anonymous stays stored-only: no live call even when serving citing.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hydrates index summaries from the source store to prove citing cases', async () => {
    // Production index hits arrive as summaries: paragraphs stripped, short
    // excerpts only. The phrase check cannot read those, so the candidate
    // is hydrated from the source store before labelling.
    const summaryHit = {
      ...hit,
      id: 'ewca-civ-2005-420',
      title: 'Later judgment applying [2003] UKHL 1',
      neutralCitation: '[2005] EWCA Civ 420',
      court: 'ewca-civ',
      dateDecided: '2005-04-01',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2005/420',
    }
    const fullDocument = {
      ...summaryHit,
      paragraphs: [
        {
          id: 'ewca-civ-2005-420-p1',
          documentId: 'ewca-civ-2005-420',
          paragraphNumber: 1,
          text: 'As held in [2003] UKHL 1, the statutory test applies here at length.',
        },
      ],
    }
    searchClientMock.search.mockResolvedValue({
      hits: [summaryHit],
      query: '[2003] UKHL 1',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const store = createInMemoryLegalAuthoritySourceStore()
    await store.upsertDocument(fullDocument, {
      documentUri: '/ewca/civ/2005/420',
      sourceUri: '/ewca/civ/2005/420',
      xmlUri: null,
      pdfUri: null,
      contentHash: 'hydration-test',
      rawAtomEntry: '<entry />',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(store, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2003] UKHL 1' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
      hits: [
        {
          id: 'ewca-civ-2005-420',
          citationMatch: 'citing',
          retrievalPath: 'stored_index',
          retrievalRank: 1,
        },
      ],
    })
    // The ranked lookup keeps the tuned floor; the citing lookup repeats
    // the same phrase without it so floor-starved citing cases verify.
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      '[2003] UKHL 1',
      { sourceType: 'judgment' },
      {
        includeSnippets: false,
        includeParagraphs: true,
        limit: 100,
        exactPhrase: '[2003] UKHL 1',
      },
    )
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      '[2003] UKHL 1',
      { sourceType: 'judgment' },
      {
        includeSnippets: false,
        includeParagraphs: true,
        exactPhrase: '[2003] UKHL 1',
        rankingScoreThreshold: null,
      },
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('excludes keyword neighbours that never quote the citation', async () => {
    // Scattered terms are not citing: a neighbour whose excerpts mention
    // the court, the year, and some other number must not serve, and a
    // judgment citing only [2003] UKHL 17 must not match [2003] UKHL 1.
    const neighbourSummary = {
      ...hit,
      id: 'ewhc-2026-1362',
      title: 'Family proceedings using the citation terms apart',
      neutralCitation: '[2026] EWHC 1362 (Fam)',
      court: 'ewhc',
      dateDecided: '2026-03-01',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewhc/2026/1362',
      snippets: [
        {
          evidenceId: 'ewhc-2026-1362:judgment_paragraph:1',
          paragraphNumber: 1,
          text: 'The EWCA revisited family appeals in 2026. Civ procedure requires permission; see paragraph 1.',
          matchedTerms: ['ewca'],
          matchReason: 'body_text_match',
        },
      ],
    }
    const siblingCiter = {
      ...hit,
      id: 'ewca-civ-2005-421',
      title: 'Judgment citing only the sibling citation',
      neutralCitation: '[2005] EWCA Civ 421',
      court: 'ewca-civ',
      dateDecided: '2005-04-02',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2005/421',
      paragraphs: [
        {
          id: 'ewca-civ-2005-421-p1',
          documentId: 'ewca-civ-2005-421',
          paragraphNumber: 1,
          text: 'As held in [2003] UKHL 17, see paragraph 1 of that judgment.',
        },
      ],
    }
    searchClientMock.search.mockResolvedValue({
      hits: [neighbourSummary],
      query: '[2003] UKHL 1',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const store = createInMemoryLegalAuthoritySourceStore()
    await store.upsertDocument(siblingCiter, {
      documentUri: '/ewca/civ/2005/421',
      sourceUri: '/ewca/civ/2005/421',
      xmlUri: null,
      pdfUri: null,
      contentHash: 'neighbour-test',
      rawAtomEntry: '<entry />',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(store, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2003] UKHL 1' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns recognised_not_held for an invented citation with no citing cases', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '[2021] EWCA Civ 9999',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(undefined, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2021] EWCA Civ 9999' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('labels citing stored hits alongside the exact judgment', async () => {
    const citing = {
      ...hit,
      id: 'ewca-civ-2026-99',
      title: 'Later judgment discussing [2024] UKSC 3',
      neutralCitation: '[2026] UKSC 99',
      court: 'uksc',
      dateDecided: '2026-01-01',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2026/99',
      paragraphs: [
        {
          id: 'ewca-civ-2026-99-p1',
          documentId: 'ewca-civ-2026-99',
          paragraphNumber: 1,
          text: 'As held in [2024] UKSC 3, permission turns on the statutory test applied here at length.',
        },
      ],
    }
    searchClientMock.search
      .mockResolvedValueOnce({
        hits: [],
        query: '[2024] UKSC 3',
        estimatedTotalHits: 0,
        processingTimeMs: 1,
      })
      .mockResolvedValueOnce({
        hits: [{ ...hit }, citing],
        query: '[2024] UKSC 3',
        estimatedTotalHits: 2,
        processingTimeMs: 1,
      })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2024] UKSC 3', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'results',
      citation: { recognised: true, status: 'held_exact' },
      hits: [
        {
          id: 'uksc-2024-3',
          citationMatch: 'exact',
          retrievalPath: 'stored_index',
        },
        {
          id: 'ewca-civ-2026-99',
          citationMatch: 'citing',
          retrievalPath: 'stored_index',
        },
      ],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves d-style document ids in canonical case URLs', async () => {
    const stableIdHit = {
      ...hit,
      id: 'd-f11e093f-8a53-4e43-8dd8-1531b5d8f018',
      title: 'Craig Alfred v Information Commissioner',
      neutralCitation: '[2026] UKFTT 754 (GRC)',
      court: 'ftt-grc',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ukftt/grc/2026/754',
    }
    searchClientMock.search.mockResolvedValueOnce({
      hits: [stableIdHit],
      query: 'Craig Alfred',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Craig Alfred' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [
        {
          id: stableIdHit.id,
          canonicalUrl:
            '/case/d-f11e093f-8a53-4e43-8dd8-1531b5d8f018-craig-alfred-v-information-commissioner-2026-ukftt-754-grc',
        },
      ],
    })
  })

  it('accepts legislation source types as implemented and searches the stored index', async () => {
    const app = createAuthenticatedProxyApp()
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'section 6',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'section 6',
        sourceType: 'legislation_provision',
        sourceFamily: 'legislation',
        legalDomain: 'human-rights',
        provider: 'legislation-gov-uk',
        topic: 'Human Rights Act',
        asAtDate: '2024-01-01',
        legislationVersion: 'current',
      }),
      headers: { 'content-type': 'application/json' },
    })

    // Stage 1 implements legislation source types: the request is searched,
    // not rejected, and judgment-only callers keep the unsupported outcome
    // for anything else. No legislation store is wired in this test, so no
    // legislation group is served.
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      hydrationQueued: false,
      outcome: 'no_match',
      diagnostics: {
        storedIndexSearched: true,
        liveProviderSearched: false,
      },
    })
    expect(searchClientMock.search).toHaveBeenCalled()
  })

  it('still returns unsupported outcome for source types neither half implements', async () => {
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'section 6',
        sourceType: 'guidance',
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'unsupported_source_type',
    })
  })

  it('returns an exact document-id hit from the stored record when the index lags', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'uksc-2024-3',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const sourceStore = {
      async upsertSummary() {
        return { indexable: true }
      },
      async upsertDocument() {
        return { indexable: true }
      },
      async get() {
        return {
          summary: hit,
          provider: {
            documentUri: '/uksc/2024/3',
            sourceUri: '/uksc/2024/3',
            xmlUri: '/uksc/2024/3/data.xml',
            pdfUri: null,
            contentHash: 'stored-exact',
            rawAtomEntry: '<entry />',
          },
        }
      },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(sourceStore)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'uksc-2024-3', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: true,
      citation: { recognised: true, status: 'held_exact' },
      diagnostics: {
        exactLookupSearched: true,
        storedIndexSearched: true,
        liveProviderSearched: false,
        citationRecognised: true,
        citationStatus: 'held_exact',
      },
      hits: [
        {
          id: 'uksc-2024-3',
          matchReason: 'exact_document_id',
          citationMatch: 'exact',
          retrievalPath: 'stored_exact_lookup',
          retrievalRank: 1,
        },
      ],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails visibly with search_unavailable when the stored index errors', async () => {
    // Meilisearch is the sole query engine: an unreachable engine is a 503
    // naming the outage, never an empty result set standing in for failure.
    searchClientMock.search.mockRejectedValueOnce(new Error('index missing'))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'search_unavailable',
        message:
          'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
        requestId: 'req_test',
      },
    })
    // No hydration is queued behind an outage: there is nothing to rank
    // the hydrated documents against until the engine answers.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails visibly with search_unavailable for anonymous citation queries when the stored index errors', async () => {
    searchClientMock.search.mockRejectedValueOnce(new Error('index missing'))
    const app = createAuthenticatedProxyApp(undefined, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2024] UKSC 3' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'search_unavailable',
        message:
          'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
        requestId: 'req_test',
      },
    })
  })

  it('keeps a stored-index miss distinct from an outage', async () => {
    // A miss with a healthy engine answers 200 with no hits; an outage
    // answers 503 naming the engine. Status code, not a diagnostics flag,
    // keeps the two distinguishable. A miss never falls back to Find Case
    // Law, so no upstream call is made either.
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const upstreamCalls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        upstreamCalls.push(String(input))
        return new Response('<feed />')
      }),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hydrationQueued: false,
      hits: [],
      outcome: 'no_match',
      diagnostics: {
        storedIndexSearched: true,
        liveProviderSearched: false,
      },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('fails visibly with search_unavailable when stored search is slow', async () => {
    // A hung engine holds the route only up to the stored-search budget,
    // then answers 503 rather than degrading to a second engine.
    searchClientMock.search.mockImplementationOnce(
      () => new Promise(() => undefined),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'search_unavailable',
        message:
          'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
        requestId: 'req_test',
      },
    })
  })

  it('rejects unsupported Find Case Law metadata filters before cache or fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        court: 'made-up-court',
        jurisdiction: 'united-kingdom',
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(searchClientMock.search).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and empty fetch queries before cache or fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const malformedResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })
    const emptyQueryResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '   ' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(malformedResponse.status).toBe(400)
    expect(emptyQueryResponse.status).toBe(400)
    expect(searchClientMock.search).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a stored legal document by id', async () => {
    searchClientMock.getDocument.mockResolvedValueOnce({
      ...hit,
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: 'The application for permission to bring proceedings under Part III is allowed.',
        },
      ],
    })
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: { id: 'uksc-2024-3', paragraphs: [{ paragraphNumber: 1 }] },
    })
  })

  it('returns a withdrawn document with a banner and no full text', async () => {
    // The derived index still holds a stale copy; Postgres is the record, so
    // the banner wins over the stale indexed full text.
    searchClientMock.getDocument.mockResolvedValueOnce({
      ...hit,
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: 'Stale indexed paragraph that must not be served.',
        },
      ],
    })
    const base = createInMemoryLegalAuthoritySourceStore()
    const store = {
      ...base,
      get: async () => ({
        summary: { ...hit },
        provider: {
          documentUri: '/uksc/2024/3',
          sourceUri: '/uksc/2024/3',
          xmlUri: '/uksc/2024/3/data.xml',
          pdfUri: null,
          contentHash: 'abc123',
          rawAtomEntry: '<entry />',
        },
        withdrawn: {
          at: '2026-09-01T00:00:00.000Z',
          checkedUris: ['/uksc/2024/3', '/uksc/2024/3/data.xml'],
          runIds: ['run-0', 'run-1'],
        },
      }),
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(200)
    const withdrawnBody = (await response.json()) as {
      document: Record<string, unknown>
      withdrawn: Record<string, unknown>
    }
    expect(withdrawnBody).toMatchObject({
      document: { id: 'uksc-2024-3' },
      withdrawn: {
        withdrawn: true,
        withdrawnAt: '2026-09-01T00:00:00.000Z',
        officialUrl: hit.sourceUrl,
      },
    })
    expect(withdrawnBody.document.paragraphs).toBeUndefined()
  })

  it('excludes withdrawn rows from fetch search results', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'uksc-2024-3',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const base = createInMemoryLegalAuthoritySourceStore()
    // Withdrawn rows never surface in search: the exact-id record read
    // below drops the flagged row, and the empty index contributes nothing.
    const store = {
      ...base,
      get: async () => ({
        summary: { ...hit },
        document: { ...hit },
        provider: {
          documentUri: '/uksc/2024/3',
          sourceUri: '/uksc/2024/3',
          xmlUri: null,
          pdfUri: null,
          contentHash: 'abc123',
          rawAtomEntry: '<entry />',
        },
        withdrawn: {
          at: '2026-09-01T00:00:00.000Z',
          checkedUris: ['/uksc/2024/3'],
          runIds: ['run-0', 'run-1'],
        },
      }),
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'uksc-2024-3' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ hits: [] })
  })

  it('rejects invalid stored document ids before storage lookup', async () => {
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/documents/uksc_2024_1')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(searchClientMock.getDocument).not.toHaveBeenCalled()
  })

  it('returns not found when a stored legal document lookup misses', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    const app = createAuthenticatedProxyApp()

    const response = await app.request(
      '/api/search/documents/uksc-2024-missing',
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'document_not_found' },
    })
  })

  it('filters stale withdrawn hits from the derived index before responding', async () => {
    // The derived index still holds the copy; Postgres is the record, so the
    // stale hit is dropped and the browse reads empty instead of serving it.
    searchClientMock.search.mockResolvedValue({
      hits: [hit],
      query: '',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const base = createInMemoryLegalAuthoritySourceStore()
    const store = {
      ...base,
      get: async () => ({
        summary: { ...hit },
        provider: {
          documentUri: '/uksc/2024/3',
          sourceUri: '/uksc/2024/3',
          xmlUri: '/uksc/2024/3/data.xml',
          pdfUri: null,
          contentHash: 'abc123',
          rawAtomEntry: '<entry />',
        },
        withdrawn: {
          at: '2026-09-01T00:00:00.000Z',
          checkedUris: ['/uksc/2024/3', '/uksc/2024/3/data.xml'],
          runIds: ['run-0', 'run-1'],
        },
      }),
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '',
        court: 'uksc',
        foregroundLiveResults: false,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'stored_browse_empty',
    })
  })

  it('drops an exact derived-index hit for a withdrawn row', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [hit],
      query: 'uksc-2024-3',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const base = createInMemoryLegalAuthoritySourceStore()
    const store = {
      ...base,
      get: async () => ({
        summary: { ...hit },
        document: { ...hit },
        provider: {
          documentUri: '/uksc/2024/3',
          sourceUri: '/uksc/2024/3',
          xmlUri: null,
          pdfUri: null,
          contentHash: 'abc123',
          rawAtomEntry: '<entry />',
        },
        withdrawn: {
          at: '2026-09-01T00:00:00.000Z',
          checkedUris: ['/uksc/2024/3'],
          runIds: ['run-0', 'run-1'],
        },
      }),
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'uksc-2024-3' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      hydrationQueued: false,
      outcome: 'recognised_not_held',
    })
  })

  it('fails closed on the document route when the store times out', async () => {
    // The derived index may hold a stale full text; an unknown store state
    // must 503, never fall through to it.
    searchClientMock.getDocument.mockResolvedValueOnce({
      ...hit,
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: 'Stale indexed paragraph that must not be served.',
        },
      ],
    })
    const store = {
      async upsertSummary() {
        return { indexable: true }
      },
      async upsertDocument() {
        return { indexable: true }
      },
      get() {
        return new Promise<null>(() => undefined)
      },
      async search() {
        return []
      },
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(searchClientMock.getDocument).not.toHaveBeenCalled()
  })

  it('fails closed on the document route when the store errors', async () => {
    searchClientMock.getDocument.mockResolvedValueOnce({ ...hit })
    const store = {
      async upsertSummary() {
        return { indexable: true }
      },
      async upsertDocument() {
        return { indexable: true }
      },
      async get() {
        throw new Error('database unreachable')
      },
      async search() {
        return []
      },
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(searchClientMock.getDocument).not.toHaveBeenCalled()
  })
})

describe('Find Case Law parsing', () => {
  it('extracts Atom entries and judgment paragraphs', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier></entry></feed>',
        { query: 'Potanina' },
      ),
    ).toMatchObject([{ neutralCitation: '[2024] UKSC 3', uri: '/uksc/2024/3' }])

    expect(
      parseJudgmentParagraphs(
        '<main><p>We place some essential cookies on your device to make this website work.</p><article><p>First paragraph with enough text to become a search excerpt.</p></article></main>',
        'uksc-2024-3',
      ),
    ).toMatchObject([{ paragraphNumber: 1, documentId: 'uksc-2024-3' }])
    expect(
      parseJudgmentParagraphs(
        '<main><p>We place some essential cookies on your device to make this website work.</p><p>First paragraph with enough text to become a search excerpt.</p></main>',
        'uksc-2024-3',
      ),
    ).toEqual([
      {
        id: 'uksc-2024-3-p1',
        documentId: 'uksc-2024-3',
        paragraphNumber: 1,
        text: 'First paragraph with enough text to become a search excerpt.',
      },
    ])
  })

  it('extracts mixed-case Court of Appeal tokens and High Court divisions', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title>Tinkler v Esken Ltd</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/659" rel="alternate"/><published>2026-05-22</published><tna:identifier slug="ewca/civ/2026/659" type="ukncn">[2026] EWCA Civ 659</tna:identifier></entry><entry><title>R v Brough</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/crim/2025/12" rel="alternate"/><published>2025-02-14</published><tna:identifier slug="ewca/crim/2025/12" type="ukncn">[2025] EWCA Crim 12</tna:identifier></entry><entry><title>R (Isherwood) v Welsh Ministers</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1157" rel="alternate"/><published>2026-05-20</published><tna:identifier slug="ewhc/admin/2026/1157" type="ukncn">[2026] EWHC 1157 (Admin)</tna:identifier></entry></feed>',
        { query: 'Example' },
      ),
    ).toMatchObject([
      {
        neutralCitation: '[2026] EWCA Civ 659',
        court: 'ewca-civ',
        uri: '/ewca/civ/2026/659',
      },
      {
        neutralCitation: '[2025] EWCA Crim 12',
        court: 'ewca-crim',
        uri: '/ewca/crim/2025/12',
      },
      {
        neutralCitation: '[2026] EWHC 1157 (Admin)',
        court: 'ewhc-admin',
        uri: '/ewhc/admin/2026/1157',
      },
    ])
  })

  it('derives court from Find Case Law path aliases when citations use provider-specific tribunal tokens', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title>Deborah Fleet v Bloomsbury Law Solicitors</title><link href="https://caselaw.nationalarchives.gov.uk/ukftt/pc/2026/472" rel="alternate"/><published>2026-03-25T00:00:00+00:00</published><author><name>Land Registration Division (Property Chamber)</name></author><id>https://caselaw.nationalarchives.gov.uk/id/d-d6a1c934-558f-493b-9413-3967c037f380</id><tna:identifier slug="ukftt/pc/2026/472" type="ukncn">[2026] UKFTT 472 (PC)</tna:identifier><tna:uri>d-d6a1c934-558f-493b-9413-3967c037f380</tna:uri></entry></feed>',
        { query: 'Deborah Fleet', court: 'ftt-pc' },
      ),
    ).toMatchObject([
      {
        neutralCitation: '[2026] UKFTT 472 (PC)',
        court: 'ftt-pc',
        uri: '/d-d6a1c934-558f-493b-9413-3967c037f380',
        sourceUri: '/ukftt/pc/2026/472',
      },
    ])
  })

  it('keeps provider-identified tribunal entries when the court filter supplies the trusted court', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title>NHS England v Justin Yung Hui Chin</title><link href="https://caselaw.nationalarchives.gov.uk/tna.74vv2rbp" rel="alternate"/><published>2026-02-26T00:00:00+00:00</published><author><name>Primary Health Lists</name></author><id>https://caselaw.nationalarchives.gov.uk/id/d-dd848612-73c3-4719-b18f-5643e51dcb17</id><tna:identifier slug="tna.74vv2rbp" type="fclid">74vv2rbp</tna:identifier><tna:uri>d-dd848612-73c3-4719-b18f-5643e51dcb17</tna:uri></entry></feed>',
        { query: 'NHS England', court: 'ftt-phl' },
      ),
    ).toMatchObject([
      {
        title: 'NHS England v Justin Yung Hui Chin',
        neutralCitation: null,
        court: 'ftt-phl',
        uri: '/d-dd848612-73c3-4719-b18f-5643e51dcb17',
        sourceUri: '/tna.74vv2rbp',
      },
    ])
  })

  it('parses Atom fallbacks, encoded content, and malformed-entry skips conservatively', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title><![CDATA[Potanina &amp; Potanin [2024] UKSC 3]]></title><id>uksc/2024/3</id><updated>2024-01-31T00:00:00Z</updated></entry><entry><title>Missing Citation</title><id>/unknown/2024/4</id><updated>2024-01-31T00:00:00Z</updated></entry></feed>',
        { query: 'Potanina' },
      ),
    ).toMatchObject([
      {
        title: 'Potanina & Potanin [2024] UKSC 3',
        neutralCitation: '[2024] UKSC 3',
        court: 'uksc',
        uri: '/uksc/2024/3',
        contentHash: expect.any(String),
      },
    ])
  })

  it('applies jurisdiction and date boundaries when parsing Atom entries', () => {
    const xml =
      '<feed><entry><title>R (Finch) v Surrey County Council</title><id>/uksc/2024/20</id><published>2024-06-20</published><tna:identifier slug="uksc/2024/20" type="ukncn">[2024] UKSC 20</tna:identifier></entry><entry><title>Potanina v Potanin</title><id>/uksc/2024/3</id><published>2024-01-31</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier></entry></feed>'

    expect(
      parseFindCaseLawAtom(xml, {
        query: 'Potanina',
        jurisdiction: 'england-and-wales',
        dateFrom: '2024-01-31',
        dateTo: '2024-01-31',
      }),
    ).toMatchObject([{ neutralCitation: '[2024] UKSC 3' }])
    expect(
      parseFindCaseLawAtom(xml, {
        query: 'Potanina',
        jurisdiction: 'scotland',
      }),
    ).toEqual([])
  })

  it('extracts all clean judgment paragraphs from noisy HTML', () => {
    const paragraphs = Array.from(
      { length: 90 },
      (_, index) =>
        `<p>Indexed paragraph ${index + 1} has enough judgment text to be retained.</p>`,
    ).join('')

    const result = parseJudgmentParagraphs(
      `<html><body><nav>Navigation text that should not appear.</nav><script>alert("x")</script><main><p>Skip to main content</p>${paragraphs}</main></body></html>`,
      'uksc-2024-3',
    )

    expect(result).toHaveLength(90)
    expect(result[0]).toMatchObject({
      id: 'uksc-2024-3-p1',
      paragraphNumber: 1,
      text: 'Indexed paragraph 1 has enough judgment text to be retained.',
    })
    expect(result.at(-1)).toMatchObject({ paragraphNumber: 90 })
  })

  it('preserves short legal paragraphs in parsed case documents', () => {
    expect(
      parseJudgmentParagraphs(
        '<article><p>I agree.</p><p>Appeal dismissed.</p><p>This longer paragraph confirms the judgment parser keeps ordinary judgment text.</p></article>',
        'uksc-2024-3',
      ),
    ).toEqual([
      {
        id: 'uksc-2024-3-p1',
        documentId: 'uksc-2024-3',
        paragraphNumber: 1,
        text: 'I agree.',
      },
      {
        id: 'uksc-2024-3-p2',
        documentId: 'uksc-2024-3',
        paragraphNumber: 2,
        text: 'Appeal dismissed.',
      },
      {
        id: 'uksc-2024-3-p3',
        documentId: 'uksc-2024-3',
        paragraphNumber: 3,
        text: 'This longer paragraph confirms the judgment parser keeps ordinary judgment text.',
      },
    ])
  })

  it('uses stable tna document URIs while preserving the human source URL', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title>Potanina v Potanin</title><id>https://caselaw.nationalarchives.gov.uk/id/d-f11e093f-8a53-4e43-8dd8-1531b5d8f018</id><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31</published><tna:uri>d-f11e093f-8a53-4e43-8dd8-1531b5d8f018</tna:uri><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier></entry></feed>',
        { query: 'Potanina' },
      ),
    ).toMatchObject([
      {
        neutralCitation: '[2024] UKSC 3',
        uri: '/d-f11e093f-8a53-4e43-8dd8-1531b5d8f018',
        sourceUri: '/uksc/2024/3',
        xmlUri: '/uksc/2024/3/data.xml',
      },
    ])
  })

  it('extracts all current Find Case Law court and tribunal citation forms', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title>Admiralty Example</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admlty/2024/1" rel="alternate"/><published>2024-01-31</published><tna:identifier slug="ewhc/admlty/2024/1" type="ukncn">[2024] EWHC 1 (Admlty)</tna:identifier></entry><entry><title>Patent Example</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/pat/2024/2" rel="alternate"/><published>2024-02-01</published><tna:identifier slug="ewhc/pat/2024/2" type="ukncn">[2024] EWHC 2 (Pat)</tna:identifier></entry><entry><title>Tribunal Example</title><link href="https://caselaw.nationalarchives.gov.uk/ukut/iac/2024/3" rel="alternate"/><published>2024-02-02</published><tna:identifier slug="ukut/iac/2024/3" type="ukncn">[2024] UKUT 3 (IAC)</tna:identifier></entry><entry><title>Tax Example</title><link href="https://caselaw.nationalarchives.gov.uk/ukftt/tc/2024/4" rel="alternate"/><published>2024-02-03</published><tna:identifier slug="ukftt/tc/2024/4" type="ukncn">[2024] UKFTT 4 (TC)</tna:identifier></entry><entry><title>Employment Example</title><link href="https://caselaw.nationalarchives.gov.uk/eat/2024/5" rel="alternate"/><published>2024-02-04</published><tna:identifier slug="eat/2024/5" type="ukncn">[2024] EAT 5</tna:identifier></entry><entry><title>Investigatory Powers Example</title><link href="https://caselaw.nationalarchives.gov.uk/ukiptrib/2024/6" rel="alternate"/><published>2024-02-05</published><tna:identifier slug="ukiptrib/2024/6" type="ukncn">[2024] UKIPTrib 6</tna:identifier></entry><entry><title>Crown Court Example</title><link href="https://caselaw.nationalarchives.gov.uk/ewcr/2024/7" rel="alternate"/><published>2024-02-06</published><tna:identifier slug="ewcr/2024/7" type="ukncn">[2024] EWCR 7</tna:identifier></entry></feed>',
        { query: 'Example' },
      ),
    ).toMatchObject([
      { neutralCitation: '[2024] EWHC 1 (Admlty)', court: 'ewhc-admlty' },
      { neutralCitation: '[2024] EWHC 2 (Pat)', court: 'ewhc-pat' },
      { neutralCitation: '[2024] UKUT 3 (IAC)', court: 'ukut-iac' },
      { neutralCitation: '[2024] UKFTT 4 (TC)', court: 'ukftt-tc' },
      { neutralCitation: '[2024] EAT 5', court: 'eat' },
      { neutralCitation: '[2024] UKIPTrib 6', court: 'ukiptrib' },
      { neutralCitation: '[2024] EWCR 7', court: 'ewcr' },
    ])
  })
})

describe('corpus-only provider boundary', () => {
  // A counting fake provider: any route that dispatches an upstream request
  // records the URL here. The fake rejects as well as counts, so a path that
  // reaches Find Case Law fails loudly instead of quietly succeeding.
  const upstreamCalls: string[] = []
  const providerMetadata = {
    documentUri: '/uksc/2024/3',
    sourceUri: '/uksc/2024/3',
    xmlUri: null,
    pdfUri: null,
    contentHash: 'corpus-only-test',
    rawAtomEntry: '<entry />',
  }

  beforeEach(() => {
    upstreamCalls.length = 0
    searchClientMock.search.mockReset()
    searchClientMock.getDocument.mockReset()
    searchClientMock.indexDocuments.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        upstreamCalls.push(String(input))
        throw new Error('Find Case Law must not be contacted by the API')
      }),
    )
  })

  function emptySearch() {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
  }

  async function fetchSearch(
    app: ReturnType<typeof createAuthenticatedProxyApp>,
    body: Record<string, unknown>,
  ) {
    return app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  }

  it('never contacts the provider on an authenticated search miss', async () => {
    emptySearch()
    const app = createAuthenticatedProxyApp()

    const response = await fetchSearch(app, {
      query: 'Potanina',
      court: 'uksc',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      hydrationQueued: false,
      outcome: 'no_match',
      diagnostics: { liveProviderSearched: false, storedIndexSearched: true },
    })
    expect(upstreamCalls).toEqual([])
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('accepts foregroundLiveResults but reports it as ignored', async () => {
    emptySearch()
    const app = createAuthenticatedProxyApp()

    const response = await fetchSearch(app, {
      query: 'Potanina',
      court: 'uksc',
      foregroundLiveResults: true,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hydrationQueued: false,
      outcome: 'no_match',
      diagnostics: {
        liveProviderSearched: false,
        foregroundLiveIgnored: true,
      },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('omits foregroundLiveIgnored when the client did not request live results', async () => {
    emptySearch()
    const app = createAuthenticatedProxyApp()

    const response = await fetchSearch(app, {
      query: 'Potanina',
      court: 'uksc',
    })
    const body = (await response.json()) as {
      diagnostics?: { foregroundLiveIgnored?: boolean }
    }

    expect(body.diagnostics?.foregroundLiveIgnored).toBeUndefined()
  })

  it('serves an anonymous miss from the corpus without contacting the provider', async () => {
    emptySearch()
    const app = createAuthenticatedProxyApp(undefined, undefined, null)

    const response = await fetchSearch(app, {
      query: 'Potanina',
      court: 'uksc',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hydrationQueued: false,
      outcome: 'no_match',
      diagnostics: { liveProviderSearched: false },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('answers a recognised citation miss honestly without contacting the provider', async () => {
    emptySearch()
    const app = createAuthenticatedProxyApp()

    const response = await fetchSearch(app, { query: '[2099] UKSC 1' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hydrationQueued: false,
      outcome: 'recognised_not_held',
      diagnostics: { liveProviderSearched: false },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('never contacts the provider on a document-detail miss', async () => {
    searchClientMock.getDocument.mockResolvedValueOnce(null)
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'document_not_found',
        message: 'Document is not held in the local corpus.',
      },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('serves a stored summary-only record without contacting the provider', async () => {
    // A PDF-only judgment has a stored summary and no full text. It is held
    // locally, so the route serves the metadata instead of a not-found or a
    // provider fetch.
    searchClientMock.getDocument.mockResolvedValueOnce(null)
    const store = createInMemoryLegalAuthoritySourceStore()
    await store.upsertSummary(hit, providerMetadata)
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: {
        id: 'uksc-2024-3',
        title: 'Potanina v Potanin',
        sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('serves a stored document while the provider is unreachable', async () => {
    searchClientMock.getDocument.mockResolvedValueOnce({
      ...hit,
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: 'A stored paragraph served with no upstream call.',
        },
      ],
    })
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: { id: 'uksc-2024-3', paragraphs: [{ paragraphNumber: 1 }] },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('serves a Postgres-stored document while the provider is unreachable', async () => {
    searchClientMock.getDocument.mockResolvedValueOnce(null)
    const store = createInMemoryLegalAuthoritySourceStore()
    await store.upsertDocument(
      {
        ...hit,
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'A Postgres-stored paragraph served with no upstream call.',
          },
        ],
      },
      providerMetadata,
    )
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: { id: 'uksc-2024-3' },
    })
    expect(upstreamCalls).toEqual([])
  })

  it('fails visibly on an index outage without falling back to the provider', async () => {
    searchClientMock.search.mockRejectedValueOnce(new Error('engine down'))
    const app = createAuthenticatedProxyApp()

    const response = await fetchSearch(app, {
      query: 'Potanina',
      court: 'uksc',
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'search_unavailable' },
    })
    expect(upstreamCalls).toEqual([])
  })
})
