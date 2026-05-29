import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLegalSearchProxyRoutes,
  createPostgresLegalAuthoritySourceStore,
  parseFindCaseLawAtom,
  parseJudgmentParagraphs,
} from '../proxy-routes'
import type { ApiEnv } from '../../../env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  indexDocuments: vi.fn(),
  getDocument: vi.fn(),
  search: vi.fn(),
}))

vi.mock('@ormont/search-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ormont/search-client')>()),
  ...searchClientMock,
}))

const env: ApiEnv = {
  databaseUrl: 'postgres://ormont:ormont@localhost:5432/ormont',
  authSecret: 'dev-only-better-auth-secret',
  authBaseUrl: 'http://localhost:8787',
  webOrigin: 'http://localhost:3000',
  desktopOrigin: 'ormont://desktop-auth',
  magicLinkWebhookUrl: null,
  magicLinkWebhookSecret: null,
  meilisearchHost: 'http://localhost:7700',
  meilisearchSearchApiKey: 'dev-key',
  meilisearchAdminApiKey: 'dev-key',
  legalAuthoritiesIndex: 'legal_authorities',
  mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
  mojFindCaseLawRateLimit: 1000,
  port: 8787,
  nodeEnv: 'test',
}

const hit = {
  id: 'uksc-2024-1',
  title: 'Potanina v Potanin',
  neutralCitation: '[2024] UKSC 3',
  court: 'uksc',
  jurisdiction: 'england-and-wales',
  dateDecided: '2024-01-31',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
}

const findCaseLawCourtCases = [
  { requestCourt: 'eat', apiCourt: 'eat', storedCourt: 'eat', citation: '[2024] EAT 1' },
  { requestCourt: 'uksc', apiCourt: 'uksc', storedCourt: 'uksc', citation: '[2024] UKSC 2' },
  { requestCourt: 'ukpc', apiCourt: 'ukpc', storedCourt: 'ukpc', citation: '[2024] UKPC 3' },
  { requestCourt: 'ewca/civ', apiCourt: 'ewca/civ', storedCourt: 'ewca-civ', citation: '[2024] EWCA Civ 4' },
  { requestCourt: 'ewca/crim', apiCourt: 'ewca/crim', storedCourt: 'ewca-crim', citation: '[2024] EWCA Crim 5' },
  { requestCourt: 'ewcr', apiCourt: 'ewcr', storedCourt: 'ewcr', citation: '[2024] EWCR 6' },
  { requestCourt: 'ewhc/admin', apiCourt: 'ewhc/admin', storedCourt: 'ewhc-admin', citation: '[2024] EWHC 7 (Admin)' },
  { requestCourt: 'ewhc/admlty', apiCourt: 'ewhc/admlty', storedCourt: 'ewhc-admlty', citation: '[2024] EWHC 8 (Admlty)' },
  { requestCourt: 'ewhc/ch', apiCourt: 'ewhc/ch', storedCourt: 'ewhc-ch', citation: '[2024] EWHC 9 (Ch)' },
  { requestCourt: 'ewhc/comm', apiCourt: 'ewhc/comm', storedCourt: 'ewhc-comm', citation: '[2024] EWHC 10 (Comm)' },
  { requestCourt: 'ewhc/fam', apiCourt: 'ewhc/fam', storedCourt: 'ewhc-fam', citation: '[2024] EWHC 11 (Fam)' },
  { requestCourt: 'ewhc/ipec', apiCourt: 'ewhc/ipec', storedCourt: 'ewhc-ipec', citation: '[2024] EWHC 12 (IPEC)' },
  { requestCourt: 'ewhc/kb', apiCourt: 'ewhc/kb', storedCourt: 'ewhc-kb', citation: '[2024] EWHC 13 (KB)' },
  { requestCourt: 'ewhc/mercantile', apiCourt: 'ewhc/mercantile', storedCourt: 'ewhc-mercantile', citation: '[2024] EWHC 14 (Mercantile)' },
  { requestCourt: 'ewhc/pat', apiCourt: 'ewhc/pat', storedCourt: 'ewhc-pat', citation: '[2024] EWHC 15 (Pat)' },
  { requestCourt: 'ewhc/scco', apiCourt: 'ewhc/scco', storedCourt: 'ewhc-scco', citation: '[2024] EWHC 16 (SCCO)' },
  { requestCourt: 'ewhc/tcc', apiCourt: 'ewhc/tcc', storedCourt: 'ewhc-tcc', citation: '[2024] EWHC 17 (TCC)' },
  { requestCourt: 'ewfc', apiCourt: 'ewfc', storedCourt: 'ewfc', citation: '[2024] EWFC 18' },
  { requestCourt: 'ewcop', apiCourt: 'ewcop', storedCourt: 'ewcop', citation: '[2024] EWCOP 19' },
  { requestCourt: 'ewcc', apiCourt: 'ewcc', storedCourt: 'ewcc', citation: '[2024] EWCC 20' },
  { requestCourt: 'ukiptrib', apiCourt: 'ukiptrib', storedCourt: 'ukiptrib', citation: '[2024] UKIPTrib 21' },
  { requestCourt: 'siac', apiCourt: 'siac', storedCourt: 'siac', citation: '[2024] SIAC 22' },
  { requestCourt: 'ukist', apiCourt: 'ukist', storedCourt: 'ukist', citation: '[2024] UKIST 23' },
  { requestCourt: 'ukut/aac', apiCourt: 'ukut/aac', storedCourt: 'ukut-aac', citation: '[2024] UKUT 24 (AAC)' },
  { requestCourt: 'ukut/iac', apiCourt: 'ukut/iac', storedCourt: 'ukut-iac', citation: '[2024] UKUT 25 (IAC)' },
  { requestCourt: 'ukut/lc', apiCourt: 'ukut/lc', storedCourt: 'ukut-lc', citation: '[2024] UKUT 26 (LC)' },
  { requestCourt: 'ukut/tcc', apiCourt: 'ukut/tcc', storedCourt: 'ukut-tcc', citation: '[2024] UKUT 27 (TCC)' },
  { requestCourt: 'ukftt/credit', apiCourt: 'ukftt/credit', storedCourt: 'ukftt-credit', citation: '[2024] UKFTT 28 (Credit)' },
  { requestCourt: 'ukftt/estate', apiCourt: 'ukftt/estate', storedCourt: 'ukftt-estate', citation: '[2024] UKFTT 29 (Estate)' },
  { requestCourt: 'ukftt/grc', apiCourt: 'ukftt/grc', storedCourt: 'ukftt-grc', citation: '[2024] UKFTT 30 (GRC)' },
  { requestCourt: 'ukftt/hesc', apiCourt: 'ukftt/hesc', storedCourt: 'ukftt-hesc', citation: '[2024] UKFTT 31 (HESC)' },
  { requestCourt: 'ukftt/tc', apiCourt: 'ukftt/tc', storedCourt: 'ukftt-tc', citation: '[2024] UKFTT 32 (TC)' },
  { requestCourt: 'ftt/claims', apiCourt: 'ftt/claims', storedCourt: 'ftt-claims', citation: '[2024] FTT 33 (Claims)' },
  { requestCourt: 'ftt/pc', apiCourt: 'ftt/pc', storedCourt: 'ftt-pc', citation: '[2024] FTT 34 (PC)' },
  { requestCourt: 'ftt/phl', apiCourt: 'ftt/phl', storedCourt: 'ftt-phl', citation: '[2024] FTT 35 (PHL)' },
  { requestCourt: 'ftt/transport', apiCourt: 'ftt/transport', storedCourt: 'ftt-transport', citation: '[2024] FTT 36 (Transport)' },
] as const

const liveFindCaseLawCourtCases = [
  { court: 'uksc', storedCourt: 'uksc', citation: '[2026] UKSC 15' },
  { court: 'ukpc', storedCourt: 'ukpc', citation: '[2026] UKPC 22' },
  { court: 'ewca/civ', storedCourt: 'ewca-civ', citation: '[2026] EWCA Civ 659' },
  { court: 'ewca/crim', storedCourt: 'ewca-crim', citation: '[2026] EWCA Crim 637' },
  { court: 'ewhc/admin', storedCourt: 'ewhc-admin', citation: '[2026] EWHC 1246 (Admin)' },
  { court: 'ewhc/ch', storedCourt: 'ewhc-ch', citation: '[2026] EWHC 1182 (Ch)' },
  { court: 'ewhc/comm', storedCourt: 'ewhc-comm', citation: '[2026] EWHC 1236 (Comm)' },
  { court: 'ewhc/fam', storedCourt: 'ewhc-fam', citation: '[2026] EWHC 1100 (Fam)' },
  { court: 'ewhc/kb', storedCourt: 'ewhc-kb', citation: '[2026] EWHC 1245 (KB)' },
  { court: 'ewfc', storedCourt: 'ewfc', citation: '[2026] EWFC 116 (B)' },
  { court: 'ewcop', storedCourt: 'ewcop', citation: '[2026] EWCOP 23 (T3)' },
  { court: 'ewcc', storedCourt: 'ewcc', citation: '[2026] EWCC 29' },
  { court: 'eat', storedCourt: 'eat', citation: '[2026] EAT 74' },
  { court: 'ukut/iac', storedCourt: 'ukut-iac', citation: '[2026] UKUT 150 (IAC)' },
] as const

beforeEach(() => {
  vi.restoreAllMocks()
  searchClientMock.search.mockReset()
  searchClientMock.indexDocuments.mockReset()
  searchClientMock.getDocument.mockReset()
})

describe('createLegalSearchProxyRoutes', () => {
  it('returns cached results without calling Find Case Law', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [
        {
          ...hit,
          paragraphs: [
            {
              id: 'uksc-2024-1-p1',
              documentId: 'uksc-2024-1',
              paragraphNumber: 1,
              text: 'Cached search responses should stay summary-only.',
            },
          ],
        },
      ],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { hits: Array<Record<string, unknown>> }
    expect(body).toMatchObject({
      cached: true,
      hits: [hit],
      indexedCount: 0,
    })
    expect(body.hits[0]).not.toHaveProperty('paragraphs')
    expect(fetchMock).not.toHaveBeenCalled()
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
    const app = createLegalSearchProxyRoutes(env)

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
    const app = createLegalSearchProxyRoutes(env)

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

  it('ranks foreground live exact matches ahead of newer partial matches', async () => {
    searchClientMock.search.mockResolvedValueOnce({
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
    const app = createLegalSearchProxyRoutes(env)

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

  it('returns storage unavailable when foreground Find Case Law summary fetch rejects', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network unavailable'))
    const app = createLegalSearchProxyRoutes(env)

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
    const app = createLegalSearchProxyRoutes(env, sourceStore)

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
    expect(fetchMock.mock.calls.map((call) => (call[0] as URL).pathname)).toContain(
      '/ewfc/2026/80',
    )
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
    const app = createLegalSearchProxyRoutes(env)

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

  it('serves later search misses from Ormont-owned source storage without calling Find Case Law again', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Potanina',
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
          `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This is a long enough judgment paragraph mentioning Potanina and the appeal.</p></body></html>',
        ),
      )
    const app = createLegalSearchProxyRoutes(env)

    const firstResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toMatchObject({ hydrationQueued: true, hits: [] })
    await vi.waitFor(() => expect(searchClientMock.indexDocuments).toHaveBeenCalled())

    fetchMock.mockClear()
    const secondResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(secondResponse.status).toBe(200)
    const secondBody = (await secondResponse.json()) as { hits: Array<Record<string, unknown>> }
    expect(secondBody).toMatchObject({
      cached: true,
      hits: [{ id: 'uksc-2024-3', neutralCitation: '[2024] UKSC 3' }],
    })
    expect(secondBody.hits[0]).not.toHaveProperty('paragraphs')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prioritizes exact source-store matches ahead of newer partial matches', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: '[2024] UKSC 3',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
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
    const sourceStore = {
      async upsertSummary() {},
      async upsertDocument() {},
      async get() {
        return null
      },
      async search() {
        return [newerPartial, exactCitation]
      },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createLegalSearchProxyRoutes(env, sourceStore)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '[2024] UKSC 3', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { hits: Array<{ id: string }> }
    expect(body.hits.map((storedHit) => storedHit.id)).toEqual([
      'uksc-2024-3',
      'uksc-2026-10',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses indexed metadata search and a database statement timeout for Postgres source fallback', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values })
        if (text.includes('from legal_source_documents')) {
          return {
            rows: [
              {
                summary_json: hit,
                document_json: {
                  ...hit,
                  paragraphs: [
                    {
                      id: 'uksc-2024-1-p1',
                      documentId: 'uksc-2024-1',
                      paragraphNumber: 1,
                      text: 'Stored paragraph text should not be scanned by fallback search.',
                    },
                  ],
                },
                provider_json: {
                  documentUri: '/uksc/2024/3',
                  sourceUri: '/uksc/2024/3',
                  xmlUri: null,
                  pdfUri: null,
                  contentHash: 'abc123',
                  rawAtomEntry: '<entry />',
                },
              },
            ],
          }
        }

        return { rows: [] }
      }),
      release: vi.fn(),
    }
    const pool = {
      connect: vi.fn(async () => client),
    }
    const store = createPostgresLegalAuthoritySourceStore(pool as never)

    const results = await store.search('Potanina', { court: 'uksc' })

    expect(results).toMatchObject([{ id: 'uksc-2024-1' }])
    expect(client.query).toHaveBeenCalledWith('begin')
    expect(client.query).toHaveBeenCalledWith('select set_config($1, $2, true)', [
      'statement_timeout',
      '350ms',
    ])
    expect(client.query).toHaveBeenCalledWith('commit')
    expect(client.release).toHaveBeenCalled()
    const searchSql = queries.find((query) =>
      query.text.includes('from legal_source_documents'),
    )?.text
    expect(searchSql).toContain('search_vector @@ websearch_to_tsquery')
    expect(searchSql).not.toContain('document_json::text')
    expect(searchSql).not.toContain("summary_json::text || ' '")
  })

  it('queues Find Case Law hydration when stored search is unavailable', async () => {
    searchClientMock.search.mockRejectedValueOnce(new Error('index missing'))
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
    const app = createLegalSearchProxyRoutes(env)

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
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [expect.objectContaining({ id: 'uksc-2024-3' })],
      ),
    )
  })

  it('queues Find Case Law hydration when stored search is slow', async () => {
    searchClientMock.search.mockImplementationOnce(() => new Promise(() => undefined))
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
    const app = createLegalSearchProxyRoutes(env)

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
      expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
        { id: 'meili-client' },
        'legal_authorities',
        [expect.objectContaining({ id: 'uksc-2024-3' })],
      ),
    )
  })

  it('keeps foreground search available when background indexing is unavailable', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.indexDocuments.mockRejectedValueOnce(new Error('index write failed'))
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
    const app = createLegalSearchProxyRoutes(env)

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
    await vi.waitFor(() => expect(searchClientMock.indexDocuments).toHaveBeenCalled())
  })

  it('rejects unsupported Find Case Law metadata filters before cache or fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createLegalSearchProxyRoutes(env)

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
    const app = createLegalSearchProxyRoutes(env)

    const malformedResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })
    const emptyQueryResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: '   ', court: 'uksc' }),
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<feed />'))
    const app = createLegalSearchProxyRoutes(env)

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
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.stringContaining('court=ewhc%2Fadmin'),
      }),
    )
  })

  it('does not let request court filters override source-derived metadata', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [],
      query: 'Potanina',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<feed><entry><title>Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2024/7" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="ewca/civ/2024/7" type="ukncn">[2024] EWCA Civ 7</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Example', court: 'uksc' }),
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
          `<feed><entry><title>Admin Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1157" rel="alternate"/><published>2026-05-20T00:00:00Z</published><tna:identifier slug="ewhc/admin/2026/1157" type="ukncn">[2026] EWHC 1157 (Admin)</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><body><p>This High Court administrative judgment paragraph is long enough for indexing.</p></body></html>',
        ),
      )
    const app = createLegalSearchProxyRoutes(env)

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
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.stringContaining('court=ewhc%2Fadmin'),
      }),
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
            `<feed><entry><title>Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk${documentUri}" rel="alternate"/><published>2024-02-01T00:00:00Z</published><tna:identifier slug="${apiCourt}/2024/1" type="ukncn">${citation}</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            '<html><body><p>This official court judgment paragraph is long enough for indexing.</p></body></html>',
          ),
        )
      const app = createLegalSearchProxyRoutes(env)

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
          search: expect.stringContaining(`court=${encodeURIComponent(apiCourt)}`),
        }),
      )
      await vi.waitFor(() =>
        expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
          { id: 'meili-client' },
          'legal_authorities',
          [expect.objectContaining({ neutralCitation: citation, court: storedCourt })],
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<feed><entry><title>Potanina v Potanin</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/3" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="uksc/2024/3" type="ukncn">[2024] UKSC 3</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry></feed>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env)

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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<feed />'))
    const app = createLegalSearchProxyRoutes(env)

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
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', dateFrom: '2024-01-01' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ hydrationQueued: true, hits: [] })
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
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ cached: true, indexedCount: 0 })
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
    const app = createLegalSearchProxyRoutes(env)

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
    const app = createLegalSearchProxyRoutes(env, sourceStore)

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
    await vi.waitFor(() => expect(sourceStore.upsertDocument).toHaveBeenCalled())
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
    const app = createLegalSearchProxyRoutes({ ...env, mojFindCaseLawRateLimit: 1 })

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
          `<feed><entry><title>Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2024/7" rel="alternate"/><published>2024-01-31T00:00:00Z</published><tna:identifier slug="ewca/civ/2024/7" type="ukncn">[2024] EWCA Civ 7</tna:identifier><tna:contenthash>abc123</tna:contenthash></entry><entry><title>Admin Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1157" rel="alternate"/><published>2026-05-20T00:00:00Z</published><tna:identifier slug="ewhc/admin/2026/1157" type="ukncn">[2026] EWHC 1157 (Admin)</tna:identifier><tna:contenthash>def456</tna:contenthash></entry></feed>`,
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
    const app = createLegalSearchProxyRoutes(env)

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
            id: 'ewca-civ-2024-7',
            neutralCitation: '[2024] EWCA Civ 7',
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
    const app = createLegalSearchProxyRoutes(env)

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }))
    const app = createLegalSearchProxyRoutes(env)

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
          id: 'uksc-2024-1-p1',
          documentId: 'uksc-2024-1',
          paragraphNumber: 1,
          text: 'Stored judgment paragraph text.',
        },
      ],
    })
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/uksc-2024-1')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: { id: 'uksc-2024-1', paragraphs: [{ paragraphNumber: 1 }] },
    })
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
        `<html><body><h1>Example v Test</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>This live judgment paragraph is long enough to render in the case reader.</p></article></body></html>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/ewhc-admin-2026-1246')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: {
        id: 'ewhc-admin-2026-1246',
        title: 'Example v Test',
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

  it('stores direct live document fallback in Ormont source storage', async () => {
    searchClientMock.search.mockResolvedValue({
      hits: [],
      query: 'Example',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    })
    searchClientMock.getDocument.mockRejectedValue(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValue({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        `<html><body><h1>Example v Test</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>This live judgment paragraph is long enough to render in the case reader.</p></article></body></html>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env)

    const firstResponse = await app.request('/api/search/documents/ewhc-admin-2026-1246')

    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toMatchObject({
      document: {
        id: 'ewhc-admin-2026-1246',
        neutralCitation: '[2026] EWHC 1246 (Admin)',
      },
    })

    fetchMock.mockClear()
    const secondResponse = await app.request('/api/search/documents/ewhc-admin-2026-1246')

    expect(secondResponse.status).toBe(200)
    expect(await secondResponse.json()).toMatchObject({
      document: {
        id: 'ewhc-admin-2026-1246',
        neutralCitation: '[2026] EWHC 1246 (Admin)',
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    const searchResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Example', court: 'ewhc/admin' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(searchResponse.status).toBe(200)
    const searchBody = (await searchResponse.json()) as { hits: Array<Record<string, unknown>> }
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
        `<html><body><h1>Example v Test</h1><h2><span>Neutral Citation Number</span>[2026] EWHC 1246 (Admin)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>This live judgment paragraph is long enough to render in the case reader.</p></article></body></html>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env, sourceStore)

    const response = await app.request('/api/search/documents/ewhc-admin-2026-1246')

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
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/ewhc-admin-2026-1246')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
      retryAfter: '120',
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('returns storage unavailable when direct live document fetch has a provider outage', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }))
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/ewhc-admin-2026-1246')

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
            sourceUri: '/uksc/2024/1',
            xmlUri: '/uksc/2024/1/data.xml',
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
    const app = createLegalSearchProxyRoutes(env, sourceStore)

    const response = await app.request('/api/search/documents/uksc-2024-1')

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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<html><body><h1>NHS Kent v OQD</h1><h2><span>Neutral Citation Number</span>[2026] EWCOP 23 (T3)</h2><article><div class="judgment-header__date">Date: 22/05/2026</div><p>This nested Court of Protection judgment paragraph is long enough to render.</p></article></body></html>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/ewcop-t3-2026-23')

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/ewcop/t3/2026/23' }),
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
    const app = createLegalSearchProxyRoutes(env)

    const searchResponse = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Craig Alfred', court: 'ukftt/grc' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(searchResponse.status).toBe(200)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const response = await app.request(`/api/search/documents/${documentId}`)

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls.map((call) => (call[0] as URL).pathname)).not.toContain(
      `/${documentId}`,
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ pathname: '/ukftt/grc/2026/754' }),
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
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/uksc_2024_1')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(searchClientMock.getDocument).not.toHaveBeenCalled()
  })

  it('returns not found when a stored legal document lookup misses', async () => {
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request('/api/search/documents/uksc-2024-missing')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'document_not_found' },
    })
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
        '<feed><entry><title>Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/civ/2024/7" rel="alternate"/><published>2024-01-31</published><tna:identifier slug="ewca/civ/2024/7" type="ukncn">[2024] EWCA Civ 7</tna:identifier></entry><entry><title>Criminal Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewca/crim/2025/12" rel="alternate"/><published>2025-02-14</published><tna:identifier slug="ewca/crim/2025/12" type="ukncn">[2025] EWCA Crim 12</tna:identifier></entry><entry><title>Admin Example v Test</title><link href="https://caselaw.nationalarchives.gov.uk/ewhc/admin/2026/1157" rel="alternate"/><published>2026-05-20</published><tna:identifier slug="ewhc/admin/2026/1157" type="ukncn">[2026] EWHC 1157 (Admin)</tna:identifier></entry></feed>',
        { query: 'Example' },
      ),
    ).toMatchObject([
      {
        neutralCitation: '[2024] EWCA Civ 7',
        court: 'ewca-civ',
        uri: '/ewca/civ/2024/7',
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
        '<feed><entry><title><![CDATA[Example &amp; Test [2024] UKSC 3]]></title><id>uksc/2024/3</id><updated>2024-01-31T00:00:00Z</updated></entry><entry><title>Missing Citation</title><id>/unknown/2024/4</id><updated>2024-01-31T00:00:00Z</updated></entry></feed>',
        { query: 'Example' },
      ),
    ).toMatchObject([
      {
        title: 'Example & Test [2024] UKSC 3',
        neutralCitation: '[2024] UKSC 3',
        court: 'uksc',
        uri: '/uksc/2024/3',
        contentHash: expect.any(String),
      },
    ])
  })

  it('applies jurisdiction and date boundaries when parsing Atom entries', () => {
    const xml =
      '<feed><entry><title>First v Test</title><id>/uksc/2024/1</id><published>2024-01-01</published><tna:identifier slug="uksc/2024/1" type="ukncn">[2024] UKSC 1</tna:identifier></entry><entry><title>Second v Test</title><id>/uksc/2024/2</id><published>2024-02-01</published><tna:identifier slug="uksc/2024/2" type="ukncn">[2024] UKSC 2</tna:identifier></entry></feed>'

    expect(
      parseFindCaseLawAtom(xml, {
        query: 'Test',
        jurisdiction: 'england-and-wales',
        dateFrom: '2024-02-01',
        dateTo: '2024-02-01',
      }),
    ).toMatchObject([{ neutralCitation: '[2024] UKSC 2' }])
    expect(parseFindCaseLawAtom(xml, { query: 'Test', jurisdiction: 'scotland' })).toEqual([])
  })

  it('extracts all clean judgment paragraphs from noisy HTML', () => {
    const paragraphs = Array.from(
      { length: 90 },
      (_, index) => `<p>Indexed paragraph ${index + 1} has enough judgment text to be retained.</p>`,
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
        '<feed><entry><title>Jarndyce v Jarndyce</title><id>https://caselaw.nationalarchives.gov.uk/id/d-f11e093f-8a53-4e43-8dd8-1531b5d8f018</id><link href="https://caselaw.nationalarchives.gov.uk/uksc/2024/123" rel="alternate"/><published>2025-04-30</published><tna:uri>d-f11e093f-8a53-4e43-8dd8-1531b5d8f018</tna:uri><tna:identifier slug="uksc/2024/123" type="ukncn">[2024] UKSC 123</tna:identifier></entry></feed>',
        { query: 'Jarndyce' },
      ),
    ).toMatchObject([
      {
        neutralCitation: '[2024] UKSC 123',
        uri: '/d-f11e093f-8a53-4e43-8dd8-1531b5d8f018',
        sourceUri: '/uksc/2024/123',
        xmlUri: '/uksc/2024/123/data.xml',
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
  process.env.ORMONT_RUN_LIVE_FIND_CASE_LAW_TESTS === '1' ? describe : describe.skip

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
      const app = createLegalSearchProxyRoutes({
        ...env,
        mojFindCaseLawRateLimit: 100,
      })

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
