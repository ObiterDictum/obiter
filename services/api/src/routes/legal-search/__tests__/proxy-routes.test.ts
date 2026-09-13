import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import {
  createLegalSearchProxyRoutes,
  parseFindCaseLawAtom,
  parseJudgmentParagraphs,
} from '../proxy-routes'
import type { ApiEnv } from '../../../env'
import {
  canonicalHydrationQueryKey,
  LegalSearchHydrationBudget,
} from '../../../legal-search-hydration-budget'
import { createTestApiEnv } from '../../../test-api-env'
import * as mojClient from '../moj-client'
import { createInMemoryLegalAuthoritySourceStore } from '../source-store'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  indexDocuments: vi.fn(),
  getDocument: vi.fn(),
  search: vi.fn(),
}))

const legislationServeMock = vi.hoisted(() => ({
  resolveLegislationFetch: vi.fn(),
}))

vi.mock('@obiter/search-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@obiter/search-client')>()),
  ...searchClientMock,
}))

vi.mock('../legislation-serve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../legislation-serve')>()),
  resolveLegislationFetch: legislationServeMock.resolveLegislationFetch,
}))

const env: ApiEnv = createTestApiEnv()

function createAuthenticatedProxyApp(
  sourceStore?: Parameters<typeof createLegalSearchProxyRoutes>[1],
  options?: Parameters<typeof createLegalSearchProxyRoutes>[2],
  user: { id: string } | null = { id: 'usr_test' },
  routeEnv: ApiEnv = env,
) {
  const proxy = createLegalSearchProxyRoutes(routeEnv, sourceStore, options)
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

const findCaseLawCourtCases = [
  {
    requestCourt: 'eat',
    apiCourt: 'eat',
    storedCourt: 'eat',
    citation: '[2024] EAT 1',
  },
  {
    requestCourt: 'uksc',
    apiCourt: 'uksc',
    storedCourt: 'uksc',
    citation: '[2024] UKSC 2',
  },
  {
    requestCourt: 'ukpc',
    apiCourt: 'ukpc',
    storedCourt: 'ukpc',
    citation: '[2024] UKPC 3',
  },
  {
    requestCourt: 'ewca/civ',
    apiCourt: 'ewca/civ',
    storedCourt: 'ewca-civ',
    citation: '[2024] EWCA Civ 4',
  },
  {
    requestCourt: 'ewca/crim',
    apiCourt: 'ewca/crim',
    storedCourt: 'ewca-crim',
    citation: '[2024] EWCA Crim 5',
  },
  {
    requestCourt: 'ewcr',
    apiCourt: 'ewcr',
    storedCourt: 'ewcr',
    citation: '[2024] EWCR 6',
  },
  {
    requestCourt: 'ewhc/admin',
    apiCourt: 'ewhc/admin',
    storedCourt: 'ewhc-admin',
    citation: '[2024] EWHC 7 (Admin)',
  },
  {
    requestCourt: 'ewhc/admlty',
    apiCourt: 'ewhc/admlty',
    storedCourt: 'ewhc-admlty',
    citation: '[2024] EWHC 8 (Admlty)',
  },
  {
    requestCourt: 'ewhc/ch',
    apiCourt: 'ewhc/ch',
    storedCourt: 'ewhc-ch',
    citation: '[2024] EWHC 9 (Ch)',
  },
  {
    requestCourt: 'ewhc/comm',
    apiCourt: 'ewhc/comm',
    storedCourt: 'ewhc-comm',
    citation: '[2024] EWHC 10 (Comm)',
  },
  {
    requestCourt: 'ewhc/fam',
    apiCourt: 'ewhc/fam',
    storedCourt: 'ewhc-fam',
    citation: '[2024] EWHC 11 (Fam)',
  },
  {
    requestCourt: 'ewhc/ipec',
    apiCourt: 'ewhc/ipec',
    storedCourt: 'ewhc-ipec',
    citation: '[2024] EWHC 12 (IPEC)',
  },
  {
    requestCourt: 'ewhc/kb',
    apiCourt: 'ewhc/kb',
    storedCourt: 'ewhc-kb',
    citation: '[2024] EWHC 13 (KB)',
  },
  {
    requestCourt: 'ewhc/mercantile',
    apiCourt: 'ewhc/mercantile',
    storedCourt: 'ewhc-mercantile',
    citation: '[2024] EWHC 14 (Mercantile)',
  },
  {
    requestCourt: 'ewhc/pat',
    apiCourt: 'ewhc/pat',
    storedCourt: 'ewhc-pat',
    citation: '[2024] EWHC 15 (Pat)',
  },
  {
    requestCourt: 'ewhc/scco',
    apiCourt: 'ewhc/scco',
    storedCourt: 'ewhc-scco',
    citation: '[2024] EWHC 16 (SCCO)',
  },
  {
    requestCourt: 'ewhc/tcc',
    apiCourt: 'ewhc/tcc',
    storedCourt: 'ewhc-tcc',
    citation: '[2024] EWHC 17 (TCC)',
  },
  {
    requestCourt: 'ewfc',
    apiCourt: 'ewfc',
    storedCourt: 'ewfc',
    citation: '[2024] EWFC 18',
  },
  {
    requestCourt: 'ewcop',
    apiCourt: 'ewcop',
    storedCourt: 'ewcop',
    citation: '[2024] EWCOP 19',
  },
  {
    requestCourt: 'ewcc',
    apiCourt: 'ewcc',
    storedCourt: 'ewcc',
    citation: '[2024] EWCC 20',
  },
  {
    requestCourt: 'ukiptrib',
    apiCourt: 'ukiptrib',
    storedCourt: 'ukiptrib',
    citation: '[2024] UKIPTrib 21',
  },
  {
    requestCourt: 'siac',
    apiCourt: 'siac',
    storedCourt: 'siac',
    citation: '[2024] SIAC 22',
  },
  {
    requestCourt: 'ukist',
    apiCourt: 'ukist',
    storedCourt: 'ukist',
    citation: '[2024] UKIST 23',
  },
  {
    requestCourt: 'ukut/aac',
    apiCourt: 'ukut/aac',
    storedCourt: 'ukut-aac',
    citation: '[2024] UKUT 24 (AAC)',
  },
  {
    requestCourt: 'ukut/iac',
    apiCourt: 'ukut/iac',
    storedCourt: 'ukut-iac',
    citation: '[2024] UKUT 25 (IAC)',
  },
  {
    requestCourt: 'ukut/lc',
    apiCourt: 'ukut/lc',
    storedCourt: 'ukut-lc',
    citation: '[2024] UKUT 26 (LC)',
  },
  {
    requestCourt: 'ukut/tcc',
    apiCourt: 'ukut/tcc',
    storedCourt: 'ukut-tcc',
    citation: '[2024] UKUT 27 (TCC)',
  },
  {
    requestCourt: 'ukftt/credit',
    apiCourt: 'ukftt/credit',
    storedCourt: 'ukftt-credit',
    citation: '[2024] UKFTT 28 (Credit)',
  },
  {
    requestCourt: 'ukftt/estate',
    apiCourt: 'ukftt/estate',
    storedCourt: 'ukftt-estate',
    citation: '[2024] UKFTT 29 (Estate)',
  },
  {
    requestCourt: 'ukftt/grc',
    apiCourt: 'ukftt/grc',
    storedCourt: 'ukftt-grc',
    citation: '[2024] UKFTT 30 (GRC)',
  },
  {
    requestCourt: 'ukftt/hesc',
    apiCourt: 'ukftt/hesc',
    storedCourt: 'ukftt-hesc',
    citation: '[2024] UKFTT 31 (HESC)',
  },
  {
    requestCourt: 'ukftt/tc',
    apiCourt: 'ukftt/tc',
    storedCourt: 'ukftt-tc',
    citation: '[2024] UKFTT 32 (TC)',
  },
  {
    requestCourt: 'ftt/claims',
    apiCourt: 'ftt/claims',
    storedCourt: 'ftt-claims',
    citation: '[2024] FTT 33 (Claims)',
  },
  {
    requestCourt: 'ftt/pc',
    apiCourt: 'ftt/pc',
    storedCourt: 'ftt-pc',
    citation: '[2024] FTT 34 (PC)',
  },
  {
    requestCourt: 'ftt/phl',
    apiCourt: 'ftt/phl',
    storedCourt: 'ftt-phl',
    citation: '[2024] FTT 35 (PHL)',
  },
  {
    requestCourt: 'ftt/transport',
    apiCourt: 'ftt/transport',
    storedCourt: 'ftt-transport',
    citation: '[2024] FTT 36 (Transport)',
  },
] as const

const liveFindCaseLawCourtCases = [
  { court: 'uksc', storedCourt: 'uksc', citation: '[2026] UKSC 15' },
  { court: 'ukpc', storedCourt: 'ukpc', citation: '[2026] UKPC 22' },
  {
    court: 'ewca/civ',
    storedCourt: 'ewca-civ',
    citation: '[2026] EWCA Civ 659',
  },
  {
    court: 'ewca/crim',
    storedCourt: 'ewca-crim',
    citation: '[2026] EWCA Crim 637',
  },
  {
    court: 'ewhc/admin',
    storedCourt: 'ewhc-admin',
    citation: '[2026] EWHC 1246 (Admin)',
  },
  {
    court: 'ewhc/ch',
    storedCourt: 'ewhc-ch',
    citation: '[2026] EWHC 1182 (Ch)',
  },
  {
    court: 'ewhc/comm',
    storedCourt: 'ewhc-comm',
    citation: '[2026] EWHC 1236 (Comm)',
  },
  {
    court: 'ewhc/fam',
    storedCourt: 'ewhc-fam',
    citation: '[2026] EWHC 1100 (Fam)',
  },
  {
    court: 'ewhc/kb',
    storedCourt: 'ewhc-kb',
    citation: '[2026] EWHC 1245 (KB)',
  },
  { court: 'ewfc', storedCourt: 'ewfc', citation: '[2026] EWFC 116 (B)' },
  { court: 'ewcop', storedCourt: 'ewcop', citation: '[2026] EWCOP 23 (T3)' },
  { court: 'ewcc', storedCourt: 'ewcc', citation: '[2026] EWCC 29' },
  { court: 'eat', storedCourt: 'eat', citation: '[2026] EAT 74' },
  {
    court: 'ukut/iac',
    storedCourt: 'ukut-iac',
    citation: '[2026] UKUT 150 (IAC)',
  },
] as const

beforeEach(() => {
  vi.restoreAllMocks()
  searchClientMock.search.mockReset()
  searchClientMock.indexDocuments.mockReset()
  searchClientMock.getDocument.mockReset()
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

  it('preserves an authoritative not-held through the foreground-live miss', async () => {
    // Finding 2: the foreground branch answered no_match without consulting
    // the legislation half, so the verdict vanished on the default signed-in
    // path. Zero live results must carry the legislation terminal.
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: true,
      titleUnresolved: false,
      ambiguous: false,
      note: '2008 c. 12 is not held.',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '2008 c. 12',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '2008 c. 12',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        liveProviderSearched: true,
        legislationNotHeld: true,
        legislationNote: '2008 c. 12 is not held.',
      },
    })
  })

  it('preserves an unresolved legislation title through the foreground-live miss', async () => {
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Children Act 1989',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'legislation_title_unresolved',
      diagnostics: {
        liveProviderSearched: true,
        legislationTitleUnresolved: true,
        legislationNote:
          'No exact legislation title match was found for "Children Act 1989".',
      },
    })
  })

  it('preserves legislation ambiguity through the foreground-live miss', async () => {
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: true,
      note: '“Sample Act 2020” names more than one stored Act. Candidates: A; B',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Sample Act 2020',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Sample Act 2020',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'legislation_ambiguous',
      diagnostics: {
        legislationAmbiguous: true,
        legislationNote:
          '“Sample Act 2020” names more than one stored Act. Candidates: A; B',
      },
    })
  })

  it('carries an underspecified-schedule corrective through the foreground-live miss', async () => {
    // Browser finding: the serve layer returns the corrective only as a note
    // for this case, so the proxy emitted legislationNote with no
    // diagnostic and the UI fell through to "No sources found". The
    // structured guidance must survive the signed-in default path.
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: false,
      scheduleUnderspecified: {
        example: 'Schedule 1 paragraph 2',
        actTitle: 'Equality Act 2010',
      },
      note: 'Sch. para. 2 of Equality Act 2010 names no schedule. Name the schedule to resolve it (for example "Schedule 1 paragraph 2").',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Sch. para. 2 Equality Act 2010',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Sch. para. 2 Equality Act 2010',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'legislation_schedule_underspecified',
      diagnostics: {
        liveProviderSearched: true,
        legislationScheduleGuidance: {
          example: 'Schedule 1 paragraph 2',
          actTitle: 'Equality Act 2010',
        },
      },
    })
  })

  it('keeps an underspecified-schedule corrective through the hydration-queued branch', async () => {
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: false,
      scheduleUnderspecified: {
        example: 'Schedule 1 paragraph 2',
        actTitle: 'Equality Act 2010',
      },
      note: 'Sch. para. 2 of Equality Act 2010 names no schedule.',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Sch. para. 2 Equality Act 2010',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const body = (await (
      await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({
          query: 'Sch. para. 2 Equality Act 2010',
          foregroundLiveResults: false,
        }),
        headers: { 'content-type': 'application/json' },
      })
    ).json()) as {
      hits: unknown[]
      hydrationQueued?: boolean
      outcome?: string
      diagnostics?: {
        legislationScheduleGuidance?: {
          example: string
          actTitle: string
        }
      }
    }

    expect(body).toMatchObject({
      hits: [],
      hydrationQueued: true,
      outcome: 'hydration_queued',
      diagnostics: {
        legislationScheduleGuidance: {
          example: 'Schedule 1 paragraph 2',
          actTitle: 'Equality Act 2010',
        },
      },
    })
  })

  it('does not hide hydrated judgment results behind a schedule corrective', async () => {
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: false,
      scheduleUnderspecified: {
        example: 'Schedule 1 paragraph 2',
        actTitle: 'Equality Act 2010',
      },
      note: 'Sch. para. 2 of Equality Act 2010 names no schedule.',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [hit],
      query: 'Sch. para. 2 Equality Act 2010',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const body = (await (
      await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({
          query: 'Sch. para. 2 Equality Act 2010',
          foregroundLiveResults: false,
        }),
        headers: { 'content-type': 'application/json' },
      })
    ).json()) as {
      hits: unknown[]
      outcome?: string
      diagnostics?: {
        legislationScheduleGuidance?: {
          example: string
          actTitle: string
        }
      }
    }

    expect(body.hits).toHaveLength(1)
    expect(body.outcome).toBe('results')
    expect(body.diagnostics?.legislationScheduleGuidance).toEqual({
      example: 'Schedule 1 paragraph 2',
      actTitle: 'Equality Act 2010',
    })
  })

  it('keeps an unresolved legislation title through the hydration-queued branch', async () => {
    // Finding 2: the transport lifecycle and the legislation diagnostic are
    // separate. A job is genuinely pending, so the outcome stays
    // hydration_queued and the client keeps polling; the verdict rides
    // diagnostics and drives the copy while the poll runs. The old response
    // carried outcome legislation_title_unresolved with hydrationQueued true,
    // so the client stopped while the job spent budget and indexed judgments
    // nothing would ever surface.
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
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Children Act 1989',
        foregroundLiveResults: false,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      hits: unknown[]
      hydrationQueued?: boolean
      outcome?: string
    }
    expect(body).toMatchObject({
      hits: [],
      hydrationQueued: true,
      outcome: 'hydration_queued',
      diagnostics: {
        legislationTitleUnresolved: true,
        legislationNote:
          'No exact legislation title match was found for "Children Act 1989".',
      },
    })
    // The explicit invariant: an empty page may not claim a queue without an
    // outcome that makes the client poll it.
    if (body.hydrationQueued === true && body.hits.length === 0) {
      expect(body.outcome).toBe('hydration_queued')
    }
  })

  it('keeps an ambiguous request polling while carrying the verdict', async () => {
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: true,
      note: '“Sample Act 2020” names more than one stored Act. Candidates: A; B',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Sample Act 2020',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const body = (await (
      await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({
          query: 'Sample Act 2020',
          foregroundLiveResults: false,
        }),
        headers: { 'content-type': 'application/json' },
      })
    ).json()) as {
      hits: unknown[]
      hydrationQueued?: boolean
      outcome?: string
      diagnostics?: { legislationAmbiguous?: boolean }
    }

    expect(body).toMatchObject({
      hits: [],
      hydrationQueued: true,
      outcome: 'hydration_queued',
      diagnostics: { legislationAmbiguous: true },
    })
  })

  it('does not hide hydrated judgment results behind a legislation verdict', async () => {
    // Once hydration lands, the stored search finds the judgment and returns
    // before the background branch: a verdict from the legislation half must
    // not suppress it. The verdict stays in diagnostics.
    legislationServeMock.resolveLegislationFetch.mockResolvedValueOnce({
      groups: [],
      citationRecognised: true,
      citationHeldExact: false,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: true,
      note: '“Sample Act 2020” names more than one stored Act. Candidates: A; B',
      searched: true,
      keywordSearchParameters: null,
    })
    searchClientMock.search.mockResolvedValue({
      hits: [hit],
      query: 'Sample Act 2020',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      legislation: {
        pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
        indexName: 'legislation_provisions',
      },
    })

    const body = (await (
      await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({
          query: 'Sample Act 2020',
          foregroundLiveResults: false,
        }),
        headers: { 'content-type': 'application/json' },
      })
    ).json()) as {
      hits: unknown[]
      outcome?: string
      diagnostics?: { legislationAmbiguous?: boolean }
    }

    expect(body.hits).toHaveLength(1)
    expect(body.outcome).toBe('results')
    expect(body.diagnostics?.legislationAmbiguous).toBe(true)
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

  it('reaches live when stored holds no exact citation hit', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '[2023] EWCA Civ 123',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Later judgment discussing [2023] EWCA Civ 123</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/99" rel="alternate"/><published>2026-01-01T00:00:00Z</published><tna:identifier slug="ewca/civ/2026/99" type="ukncn">[2026] EWCA Civ 99</tna:identifier><tna:contenthash>citing123</tna:contenthash></entry><entry><title>Unrelated costs decision</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/100" rel="alternate"/><published>2026-01-02T00:00:00Z</published><tna:identifier slug="ewca/civ/2026/100" type="ukncn">[2026] EWCA Civ 100</tna:identifier><tna:contenthash>neighbour100</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValue(
        new Response(
          '<html><body><p>This judgment paragraph is long enough for background hydration.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '[2023] EWCA Civ 123',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'results',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        storedIndexSearched: true,
        liveProviderSearched: true,
        citationRecognised: true,
        citationStatus: 'not_held',
      },
      hits: [
        {
          id: 'ewca-civ-2026-99',
          citationMatch: 'citing',
          retrievalPath: 'live_provider',
        },
        {
          id: 'ewca-civ-2026-100',
          citationMatch: 'none',
          retrievalPath: 'live_provider',
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalled()
  })

  it('falls through to live when the stored index holds no exact citation hit', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '[2023] EWCA Civ 123',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 0,
      failedCount: 0,
      errors: [],
    })
    const sourceStore = {
      async upsertSummary() {},
      async upsertDocument() {},
      async get() {
        return null
      },
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<feed />'))
    const app = createAuthenticatedProxyApp(sourceStore)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '[2023] EWCA Civ 123',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    // The mentioning case must not serve as the citation, and must not
    // suppress the live lookup that can actually hold it.
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      citation: { recognised: true, status: 'not_held' },
      diagnostics: {
        liveProviderSearched: true,
        citationStatus: 'not_held',
      },
    })
    expect(fetchMock).toHaveBeenCalled()
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
      outcome: 'hydration_queued',
      diagnostics: {
        storedIndexSearched: true,
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

  it('queues Find Case Law hydration after a cache miss without returning provider results in the foreground', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      hydrationQueued: true,
      hits: [],
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [
          expect.objectContaining({
            id: 'uksc-2024-3',
            court: 'uksc',
            jurisdiction: 'england-and-wales',
          }),
        ],
      ),
    )
  })

  it('returns live Find Case Law summaries in the foreground when requested', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        court: 'uksc',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      hydrationQueued: true,
      hits: [{ id: 'uksc-2024-3', neutralCitation: '[2024] UKSC 3' }],
      indexedCount: 0,
      skippedCount: 0,
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [
          expect.objectContaining({
            id: 'uksc-2024-3',
            court: 'uksc',
            jurisdiction: 'england-and-wales',
          }),
        ],
      ),
    )
  })

  it('returns no_match without queueing when foreground live finds nothing', async () => {
    // Regression: the foreground path set hydrationQueued unconditionally,
    // so a query with zero live results read as hydration_queued forever.
    // Live was consulted here, so the honest answer is no_match.
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'zxqwv obiter neverseen hydra q1',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'zxqwv obiter neverseen hydra q1',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'no_match',
      hydrationQueued: false,
      diagnostics: { liveProviderSearched: true },
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('returns recognised_not_held without queueing when foreground live finds no citation', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '[2021] EWCA Civ 9999',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '[2021] EWCA Civ 9999',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'recognised_not_held',
      hydrationQueued: false,
      citation: { recognised: true, status: 'not_held' },
      diagnostics: { liveProviderSearched: true },
    })
  })

  it('ranks foreground live exact matches ahead of newer partial matches', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: '[2024] UKSC 3',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 2,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Later judgment discussing [2024] UKSC 3</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2026/99" rel="alternate"/><published>2026-01-01T00:00:00Z</published><tna:identifier slug="uksc/2026/99" type="ukncn">[2026] UKSC 99</tna:identifier><tna:contenthash>partial123</tna:contenthash></entry><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>exact123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValue(
        new Response(
          '<html><body><p>This judgment paragraph is long enough for background hydration.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: '[2024] UKSC 3',
        court: 'uksc',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { hits: Array<{ id: string }> }
    expect(body.hits.map((foregroundHit) => foregroundHit.id)).toEqual([
      'uksc-2024-3',
      'uksc-2026-99',
    ])
  })

  it('ranks foreground live title matches ahead of provider hits that only mention the query', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 2,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Ferrucio Ferrara v Caroline Frances Ferrara</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/512" rel="alternate"/><published>2026-04-29T00:00:00Z</published><tna:identifier slug="ewca/civ/2026/512" type="ukncn">[2026] EWCA Civ 512</tna:identifier><tna:contenthash>body-match</tna:contenthash></entry><entry><title>Natalia Nikolaevna Potanina v Vladimir Olegovich Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/ewfc/2026/80" rel="alternate"/><published>2026-04-20T00:00:00Z</published><tna:identifier slug="ewfc/2026/80" type="ukncn">[2026] EWFC 80</tna:identifier><tna:contenthash>title-match</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValue(
        new Response(
          '<html><body><p>This judgment paragraph is long enough for background hydration.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { hits: Array<{ title: string }> }
    expect(body.hits.map((foregroundHit) => foregroundHit.title)).toEqual([
      'Natalia Nikolaevna Potanina v Vladimir Olegovich Potanin',
      'Ferrucio Ferrara v Caroline Frances Ferrara',
    ])
  })

  it('returns storage unavailable when foreground Find Case Law summary fetch rejects', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('network unavailable'),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('opens foreground d-style search results when durable source storage misses', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const sourceStore = {
      upsertSummary: vi.fn(async () => {
        throw new Error('source store unavailable')
      }),
      upsertDocument: vi.fn(async () => {
        throw new Error('source store unavailable')
      }),
      async get() {
        return null
      },
      async search() {
        return []
      },
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Natalia Nikolaevna Potanina v Vladimir Olegovich Potanin</title><id>https://caselaw.nationalarchives.gov.uk/id/d-f9e1d9a7-b267-4a57-9a63-bf9d6c955de3</id><link href="https://caselaw.nationalarchives.gov.uk/ewfc/2026/80" rel="alternate"/><published>2026-04-20T00:00:00Z</published><tna:uri>d-f9e1d9a7-b267-4a57-9a63-bf9d6c955de3</tna:uri><tna:identifier slug="ewfc/2026/80" type="ukncn">[2026] EWFC 80</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockImplementation(
        async () =>
          new Response(
            '<html><body><h1>Natalia Nikolaevna Potanina v Vladimir Olegovich Potanin</h1><h2><span>Neutral Citation Number</span>[2026] EWFC 80</h2><article><div class="judgment-header__date">Date: 20/04/2026</div><p>This foreground search result can be opened even if the durable source store missed.</p></article></body></html>',
          ),
      )
    const app = createAuthenticatedProxyApp(sourceStore)

    const searchResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })
    expect(searchResponse.status).toBe(200)
    expect(await searchResponse.json()).toMatchObject({
      hits: [{ id: 'd-f9e1d9a7-b267-4a57-9a63-bf9d6c955de3' }],
    })

    const documentResponse = await app.request(
      '/api/search/documents/d-f9e1d9a7-b267-4a57-9a63-bf9d6c955de3',
    )

    expect(documentResponse.status).toBe(200)
    expect(
      fetchMock.mock.calls.map((call) => (call[0] as URL).pathname),
    ).toContain('/ewfc/2026/80')
    expect(await documentResponse.json()).toMatchObject({
      document: {
        id: 'd-f9e1d9a7-b267-4a57-9a63-bf9d6c955de3',
        neutralCitation: '[2026] EWFC 80',
        court: 'ewfc',
      },
    })
  })

  it('hydrates Find Case Law entries that only expose provider identifiers', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'NHS England',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>NHS England v Justin Yung Hui Chin</title><link href="https://caselaw.nationalarchives.gov.uk/tna.74vv2rbp" rel="alternate"/><published>2026-02-26T00:00:00+00:00</published><author><name>Primary Health Lists</name></author><id>https://caselaw.nationalarchives.gov.uk/id/d-dd848612-73c3-4719-b18f-5643e51dcb17</id><tna:contenthash>18a9eec9aeb47b13f17991e632219989146c180732500bed2258f91a0e880311</tna:contenthash><link href="https://caselaw.nationalarchives.gov.uk/tna.74vv2rbp/data.xml" rel="alternate" type="application/akn+xml"/><tna:identifier slug="tna.74vv2rbp" type="fclid">74vv2rbp</tna:identifier><tna:uri>d-dd848612-73c3-4719-b18f-5643e51dcb17</tna:uri></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><h1>NHS England v Justin Yung Hui Chin</h1><article><div class="judgment-header__date">Date: 26/02/2026</div><p>This Primary Health Lists decision paragraph is long enough to index without a neutral citation.</p></article></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'NHS England', court: 'ftt/phl' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [
          expect.objectContaining({
            id: 'd-dd848612-73c3-4719-b18f-5643e51dcb17',
            neutralCitation: null,
            court: 'ftt-phl',
            title: 'NHS England v Justin Yung Hui Chin',
          }),
        ],
      ),
    )
  })

  it('serves later search misses from the stored index without calling Find Case Law again', async () => {
    // First request misses and queues hydration; once the derived index
    // holds the document, the same query serves from the engine. Postgres
    // is the record the index rebuilds from, never a second query path.
    searchClientMock.search
      .mockResolvedValueOnce({
        hits: [],
        query: 'Potanina',
        estimatedTotalHits: 0,
        processingTimeMs: 1,
      })
      .mockResolvedValueOnce({
        hits: [
          {
            ...hit,
            paragraphs: [
              {
                id: 'uksc-2024-3-p1',
                documentId: 'uksc-2024-3',
                paragraphNumber: 1,
                text: 'This is a long enough judgment paragraph mentioning Potanina and the appeal.',
              },
            ],
          },
        ],
        query: 'Potanina',
        estimatedTotalHits: 1,
        processingTimeMs: 1,
      })
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const firstResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toMatchObject({
      hydrationQueued: true,
      outcome: 'hydration_queued',
      hits: [],
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalled(),
    )

    fetchMock.mockClear()
    const secondResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(secondResponse.status).toBe(200)
    const secondBody = (await secondResponse.json()) as {
      hits: Array<Record<string, unknown>>
    }
    expect(secondBody).toMatchObject({
      cached: true,
      hits: [
        {
          id: 'uksc-2024-3',
          neutralCitation: '[2024] UKSC 3',
          retrievalPath: 'stored_index',
        },
      ],
    })
    expect(secondBody.hits[0]).not.toHaveProperty('paragraphs')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an exact document-id hit from the stored record when the index lags', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'uksc-2024-3',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const sourceStore = {
      async upsertSummary() {},
      async upsertDocument() {},
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
    // keeps the two distinguishable.
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hydrationQueued: true,
      hits: [],
      diagnostics: {
        storedIndexSearched: true,
      },
    })
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

  it('keeps foreground search available when background indexing is unavailable', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockRejectedValueOnce(
      new Error('index write failed'),
    )
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      hydrationQueued: true,
      hits: [],
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalled(),
    )
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

  it('normalizes uppercase dash-style court filters before cache and fetch', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Example',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<feed />'))
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Example', court: 'EWHC-Admin' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      'Example',
      expect.objectContaining({ court: 'ewhc-admin' }),
      {
        includeSnippets: false,
        includeParagraphs: true,
        limit: 100,
      },
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.stringContaining('court=ewhc%2Fadmin'),
      }),
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('does not let request court filters override source-derived metadata', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Tinkler v Esken Ltd</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/659" rel="alternate"/><published>2026-05-22T00:00:00Z</published><tna:identifier slug="ewca/civ/2026/659" type="ukncn">[2026] EWCA Civ 659</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Tinkler', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      hits: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('accepts official slash-style court filters and forwards them to Find Case Law', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Example',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>R (Isherwood) v Welsh Ministers</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1157" rel="alternate"/><published>2026-05-20T00:00:00Z</published><tna:identifier slug="ewhc/admin/2026/1157" type="ukncn">[2026] EWHC 1157 (Admin)</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This High Court administrative judgment paragraph is long enough for indexing.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Example', court: 'ewhc/admin' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      'Example',
      expect.objectContaining({ court: 'ewhc-admin' }),
      {
        includeSnippets: false,
        includeParagraphs: true,
        limit: 100,
      },
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.stringContaining('court=ewhc%2Fadmin'),
      }),
      expect.objectContaining({ redirect: 'manual' }),
    )
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [expect.objectContaining({ court: 'ewhc-admin' })],
      ),
    )
  })

  it.each(findCaseLawCourtCases)(
    'queues hydration and indexes $requestCourt results from Find Case Law',
    async ({ requestCourt, apiCourt, storedCourt, citation }) => {
      searchClientMock.search.mockResolvedValueOnce({
        hits: [],
        query: 'Example',
        estimatedTotalHits: 0,
        processingTimeMs: 1,
      })
      searchClientMock.indexDocuments.mockResolvedValueOnce({
        indexedCount: 1,
        failedCount: 0,
        errors: [],
      })
      const documentUri = `/${apiCourt}/2024/${citation.match(/\d+$/)?.[0] ?? '1'}`
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            `<feed><entry><title>Find Case Law ${storedCourt} retrieval fixture</title><link href="https://caselaw.nationalarchives.gov.uk${documentUri}" rel="alternate"/><published>2024-02-01T00:00:00Z</published><tna:identifier slug="${apiCourt}/2024/1" type="ukncn">${citation}</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            '<html><body><p>This official court judgment paragraph is long enough for indexing.</p></body></html>',
          ),
        )
      const app = createAuthenticatedProxyApp()

      const response = await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({ query: 'Example', court: requestCourt }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        cached: false,
        indexedCount: 0,
        skippedCount: 0,
        hydrationQueued: true,
        hits: [],
      })
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          search: expect.stringContaining(
            `court=${encodeURIComponent(apiCourt)}`,
          ),
        }),
        expect.objectContaining({ redirect: 'manual' }),
      )
      await vi.waitFor(() =>
        expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
          { id: 'meili-client' },
          'legal_authorities',
          [
            expect.objectContaining({
              neutralCitation: citation,
              court: storedCourt,
            }),
          ],
        ),
      )
    },
  )

  it('does not return or index fetched entries outside date filters', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', dateFrom: '2025-01-01' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      hits: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('forwards date filters to Find Case Law before local entry filtering', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<feed />'))
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        dateFrom: '2024-02-03',
        dateTo: '2025-04-05',
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const url = fetchMock.mock.calls[0]?.[0] as URL
    expect(url.searchParams.get('from_date_0')).toBe('03')
    expect(url.searchParams.get('from_date_1')).toBe('02')
    expect(url.searchParams.get('from_date_2')).toBe('2024')
    expect(url.searchParams.get('to_date_0')).toBe('05')
    expect(url.searchParams.get('to_date_1')).toBe('04')
    expect(url.searchParams.get('to_date_2')).toBe('2025')
  })

  it('follows Find Case Law Atom next pages before concluding date-filtered misses are empty', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><link rel="next" href="https://caselaw.nationalarchives.gov.uk/atom.xml?page=2"/><entry><title>Old Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2023/1" rel="alternate"/><published>2023-01-31T00:00:00Z</published><tna:identifier slug="uksc/2023/1" type="ukncn">[2023] UKSC 1</tna:identifier><tna:contenthash>old123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and pagination.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', dateFrom: '2024-01-01' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hydrationQueued: true,
      hits: [],
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [expect.objectContaining({ id: 'uksc-2024-3' })],
      ),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ search: expect.stringContaining('page=2') }),
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('does not re-index documents already returned from cache during fetch', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [hit],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: true,
      indexedCount: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('keeps the foreground response queued when background detail hydration fails', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      indexedCount: 0,
      skippedCount: 0,
      hydrationQueued: true,
      hits: [],
    })
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('does not index background-hydrated documents when source storage fails', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const sourceStore = {
      upsertSummary: vi.fn(async () => undefined),
      upsertDocument: vi.fn(async () => {
        throw new Error('source write failed')
      }),
      async get() {
        return null
      },
      async search() {
        return []
      },
    }
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp(sourceStore)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      hydrationQueued: true,
      hits: [],
    })
    await vi.waitFor(() =>
      expect(sourceStore.upsertDocument).toHaveBeenCalled(),
    )
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('keeps the foreground response queued when the local rate limit is exhausted during background hydration', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier></entry></feed>`,
      ),
    )
    const app = createAuthenticatedProxyApp(
      undefined,
      undefined,
      { id: 'usr_test' },
      { ...env, mojFindCaseLawRateLimit: 1 },
    )

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      hydrationQueued: true,
      hits: [],
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('queues Court of Appeal and High Court hydration and indexes provider documents', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Example',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 2,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Tinkler v Esken Ltd</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/659" rel="alternate"/><published>2026-05-22T00:00:00Z</published><tna:identifier slug="ewca/civ/2026/659" type="ukncn">[2026] EWCA Civ 659</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry><entry><title>R (Isherwood) v Welsh Ministers</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1157" rel="alternate"/><published>2026-05-20T00:00:00Z</published><tna:identifier slug="ewhc/admin/2026/1157" type="ukncn">[2026] EWHC 1157 (Admin)</tna:identifier><tna:contenthash>def456</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This Court of Appeal judgment paragraph is long enough for indexing.</p></body></html>',
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This High Court administrative judgment paragraph is long enough for indexing.</p></body></html>',
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Example' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      hydrationQueued: true,
      hits: [],
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'ewca-civ-2026-659',
            neutralCitation: '[2026] EWCA Civ 659',
            court: 'ewca-civ',
          }),
          expect.objectContaining({
            id: 'ewhc-admin-2026-1157',
            neutralCitation: '[2026] EWHC 1157 (Admin)',
            court: 'ewhc-admin',
          }),
        ]),
      ),
    )
  })

  it('does not expose Find Case Law rate limits on foreground search misses', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      hydrationQueued: true,
      hits: [],
    })
  })

  it('does not expose Find Case Law outages on foreground search misses', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503 }),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      hydrationQueued: true,
      hits: [],
    })
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

  it('fetches, returns, and caches a live document when stored lookup misses', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<html><body><h1>Secretary of State for the Home Department v Miah</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>The court considered the administrative law challenge and the evidence before the Secretary of State.</p></article></body></html>`,
      ),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request(
      '/api/search/documents/ewhc-admin-2026-1246',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: {
        id: 'ewhc-admin-2026-1246',
        title: 'Secretary of State for the Home Department v Miah',
        neutralCitation: '[2026] EWHC 1246 (Admin)',
        court: 'ewhc-admin',
        dateDecided: '2026-05-22',
        paragraphs: [expect.objectContaining({ paragraphNumber: 1 })],
      },
    })
    await vi.waitFor(() =>
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [expect.objectContaining({ id: 'ewhc-admin-2026-1246' })],
      ),
    )
  })

  it('stores direct live document fallback in Obiter source storage', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Miah',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.getDocument.mockRejectedValue(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            `<html><body><h1>Secretary of State for the Home Department v Miah</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>The court considered the administrative law challenge and the evidence before the Secretary of State.</p></article></body></html>`,
          ),
      )
    const app = createAuthenticatedProxyApp()

    const firstResponse = await app.request(
      '/api/search/documents/ewhc-admin-2026-1246',
    )

    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toMatchObject({
      document: {
        id: 'ewhc-admin-2026-1246',
        neutralCitation: '[2026] EWHC 1246 (Admin)',
      },
    })

    fetchMock.mockClear()
    const secondResponse = await app.request(
      '/api/search/documents/ewhc-admin-2026-1246',
    )

    expect(secondResponse.status).toBe(200)
    expect(await secondResponse.json()).toMatchObject({
      document: {
        id: 'ewhc-admin-2026-1246',
        neutralCitation: '[2026] EWHC 1246 (Admin)',
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    // The stored document serves from the derived index, not from a second
    // Postgres query path: the record feeds the engine, the engine answers.
    searchClientMock.search.mockResolvedValueOnce({
      hits: [
        {
          id: 'ewhc-admin-2026-1246',
          title: 'Secretary of State for the Home Department v Miah',
          neutralCitation: '[2026] EWHC 1246 (Admin)',
          court: 'ewhc-admin',
          jurisdiction: 'england-and-wales',
          dateDecided: '2026-05-22',
          sourceType: 'judgment',
          sourceUrl:
            'https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1246',
        },
      ],
      query: 'Miah',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const searchResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Miah', court: 'ewhc/admin' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(searchResponse.status).toBe(200)
    const searchBody = (await searchResponse.json()) as {
      hits: Array<Record<string, unknown>>
    }
    expect(searchBody).toMatchObject({
      cached: true,
      hits: [{ id: 'ewhc-admin-2026-1246' }],
    })
    expect(searchBody.hits[0]).not.toHaveProperty('paragraphs')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a storage error and skips indexing when direct live document storage fails', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    const sourceStore = {
      async upsertSummary() {},
      upsertDocument: vi.fn(async () => {
        throw new Error('source write failed')
      }),
      async get() {
        return null
      },
      async search() {
        return []
      },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<html><body><h1>Secretary of State for the Home Department v Miah</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>The court considered the administrative law challenge and the evidence before the Secretary of State.</p></article></body></html>`,
      ),
    )
    const app = createAuthenticatedProxyApp(sourceStore)

    const response = await app.request(
      '/api/search/documents/ewhc-admin-2026-1246',
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(sourceStore.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ewhc-admin-2026-1246' }),
      expect.objectContaining({ documentUri: '/ewhc/admin/2026/1246' }),
    )
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('returns rate-limit metadata when direct live document fetch is provider limited', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request(
      '/api/search/documents/ewhc-admin-2026-1246',
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
      retryAfter: '120',
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('returns storage unavailable when direct live document fetch has a provider outage', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503 }),
    )
    const app = createAuthenticatedProxyApp()

    const response = await app.request(
      '/api/search/documents/ewhc-admin-2026-1246',
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('returns rate-limit metadata when source-record live document fetch is provider limited', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    const sourceStore = {
      async upsertSummary() {},
      upsertDocument: vi.fn(),
      async get() {
        return {
          summary: hit,
          provider: {
            documentUri: '/d-source-record',
            sourceUri: '/uksc/2024/3',
            xmlUri: '/uksc/2024/3/data.xml',
            pdfUri: null,
            contentHash: 'source-record-hash',
            rawAtomEntry: '<entry />',
          },
        }
      },
      async search() {
        return []
      },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    )
    const app = createAuthenticatedProxyApp(sourceStore)

    const response = await app.request('/api/search/documents/uksc-2024-3')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
      retryAfter: '60',
    })
    expect(sourceStore.upsertDocument).not.toHaveBeenCalled()
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('fetches nested Find Case Law document paths when stored lookup misses', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<html><body><h1>NHS Kent v OQD</h1><h2><span>Neutral Citation Number</span>[2026] EWCOP 23 (T3)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>This nested Court of Protection judgment paragraph is long enough to render.</p></article></body></html>`,
        ),
      )
    const app = createAuthenticatedProxyApp()

    const response = await app.request('/api/search/documents/ewcop-t3-2026-23')

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/ewcop/t3/2026/23' }),
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(await response.json()).toMatchObject({
      document: {
        id: 'ewcop-t3-2026-23',
        neutralCitation: '[2026] EWCOP 23 (T3)',
        court: 'ewcop',
      },
    })
  })

  it('opens stable d-style documents through saved Atom alternate metadata instead of /d-id paths', async () => {
    const documentId = 'd-f11e093f-8a53-4e43-8dd8-1531b5d8f018'
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Craig Alfred',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Craig Alfred v Information Commissioner</title><id>https://caselaw.nationalarchives.gov.uk/id/${documentId}</id><link href="https://caselaw.nationalarchives.gov.uk/ukftt/grc/2026/754" rel="alternate"/><link href="https://caselaw.nationalarchives.gov.uk/ukftt/grc/2026/754/data.xml" rel="alternate" type="application/xml"/><published>2026-05-21T00:00:00Z</published><tna:uri>${documentId}</tna:uri><tna:identifier slug="ukftt/grc/2026/754" type="ukncn">[2026] UKFTT 754 (GRC)</tna:identifier><tna:contenthash>stable-abc</tna:contenthash></entry></feed>`,
        ),
      )
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(
        new Response(
          `<html><body><h1>Craig Alfred v Information Commissioner</h1><h2><span>Neutral Citation Number</span>[2026] UKFTT 754 (GRC)</h2><article><div class="judgment-header__date">Date: 21/05/2026</div><p>This tribunal judgment paragraph is long enough to render from the alternate URL.</p></article></body></html>`,
        ),
      )
    const app = createAuthenticatedProxyApp()

    const searchResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Craig Alfred', court: 'ukftt/grc' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(searchResponse.status).toBe(200)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const response = await app.request(`/api/search/documents/${documentId}`)

    expect(response.status).toBe(200)
    expect(
      fetchMock.mock.calls.map((call) => (call[0] as URL).pathname),
    ).not.toContain(`/${documentId}`)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ pathname: '/ukftt/grc/2026/754' }),
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(await response.json()).toMatchObject({
      document: {
        id: documentId,
        neutralCitation: '[2026] UKFTT 754 (GRC)',
        court: 'ukftt-grc',
      },
    })
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed />'),
    )
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'uksc-2024-3' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      outcome: 'hydration_queued',
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
      async upsertSummary() {},
      async upsertDocument() {},
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
      async upsertSummary() {},
      async upsertDocument() {},
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

  it('skips withdrawn rows during live hydration without dropping live hits', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const store = {
      upsertSummary: vi.fn(async () => undefined),
      upsertDocument: vi.fn(async () => undefined),
      async get() {
        return {
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
        }
      },
      async search() {
        return []
      },
    }
    const app = createAuthenticatedProxyApp(store)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Potanina',
        court: 'uksc',
        foregroundLiveResults: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    // The live hit is verified present right now, so it serves; the
    // withdrawn mark only blocks it from being cached or re-indexed.
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [{ id: 'uksc-2024-3' }],
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(store.upsertSummary).not.toHaveBeenCalled()
    expect(store.upsertDocument).not.toHaveBeenCalled()
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
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

const describeLiveFindCaseLaw =
  process.env.OBITER_RUN_LIVE_FIND_CASE_LAW_TESTS === '1'
    ? describe
    : describe.skip

describeLiveFindCaseLaw('Find Case Law live retrieval', () => {
  it.each(liveFindCaseLawCourtCases)(
    'retrieves a live case from $court',
    async ({ court, storedCourt, citation }) => {
      searchClientMock.search.mockResolvedValueOnce({
        hits: [],
        query: citation,
        estimatedTotalHits: 0,
        processingTimeMs: 1,
      })
      searchClientMock.indexDocuments.mockResolvedValueOnce({
        indexedCount: 1,
        failedCount: 0,
        errors: [],
      })
      const app = createAuthenticatedProxyApp(
        undefined,
        undefined,
        { id: 'usr_test' },
        { ...env, mojFindCaseLawRateLimit: 100 },
      )

      const response = await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({ query: citation, court }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        cached: false,
        indexedCount: 0,
        hydrationQueued: true,
        hits: [],
      })
      await vi.waitFor(() =>
        expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
          { id: 'meili-client' },
          'legal_authorities',
          [
            expect.objectContaining({
              neutralCitation: citation,
              court: storedCourt,
              paragraphs: expect.arrayContaining([
                expect.objectContaining({ text: expect.any(String) }),
              ]),
            }),
          ],
        ),
      )
    },
    30_000,
  )
})

describe('search hydration guards', () => {
  it('returns stored-only empty results for anonymous cache misses without provider hydration', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const hydrateSpy = vi
      .spyOn(mojClient, 'hydrateMojAuthoritiesFromSearch')
      .mockResolvedValue(undefined)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAuthenticatedProxyApp(undefined, undefined, null)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hits: [],
      hydrationQueued: false,
      outcome: 'no_match',
      diagnostics: {
        liveProviderSearched: false,
        storedIndexSearched: true,
      },
    })
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates in-flight authenticated misses without starting a second hydrate job', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const hydrateSpy = vi
      .spyOn(mojClient, 'hydrateMojAuthoritiesFromSearch')
      .mockImplementation(() => new Promise(() => undefined))
    const app = createAuthenticatedProxyApp()

    const request = {
      method: 'POST' as const,
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    }
    const [firstResponse, secondResponse] = await Promise.all([
      app.request('/api/search/fetch', request),
      app.request('/api/search/fetch', request),
    ])

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(await firstResponse.json()).toMatchObject({
      hydrationQueued: true,
      outcome: 'hydration_queued',
    })
    expect(await secondResponse.json()).toMatchObject({
      hydrationQueued: true,
      outcome: 'hydration_queued',
    })
    expect(hydrateSpy).toHaveBeenCalledTimes(1)
  })

  it('returns hydration_budget_exceeded when the authenticated queue is full', async () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 24,
      perClientMax: 12,
      windowMs: 600_000,
    })
    for (let index = 0; index < 24; index += 1) {
      budget.tryBeginHydration(
        'usr_test',
        canonicalHydrationQueryKey({ query: `queued-${index}` }),
      )
    }
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Example',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      hydrationBudget: budget,
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Example', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'hydration_budget_exceeded',
        message: 'Search hydration budget exceeded. Try again later.',
      },
    })
  })

  it('returns hydration_budget_exceeded on the 13th distinct authenticated miss for one user', async () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 24,
      perClientMax: 12,
      windowMs: 600_000,
    })
    const app = createAuthenticatedProxyApp(undefined, {
      hydrationBudget: budget,
    })

    for (let index = 0; index < 12; index += 1) {
      searchClientMock.search.mockResolvedValueOnce({
        hits: [],
        query: `query-${index}`,
        estimatedTotalHits: 0,
        processingTimeMs: 1,
      })
      const response = await app.request('/api/search/fetch', {
        method: 'POST',
        body: JSON.stringify({ query: `query-${index}`, court: 'uksc' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ hydrationQueued: true })
      budget.completeHydration(
        canonicalHydrationQueryKey({ query: `query-${index}`, court: 'uksc' }),
      )
    }

    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'query-12',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'query-12', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: { code: 'hydration_budget_exceeded' },
    })
  })
})
