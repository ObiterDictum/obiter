import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLegalSearchProxyRoutes, parseFindCaseLawAtom, parseJudgmentParagraphs } from './legal-search-proxy'
import type { ApiEnv } from '../env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  indexDocuments: vi.fn(),
  getDocument: vi.fn(),
  search: vi.fn(),
}))

vi.mock('@ormont/search-client', () => searchClientMock)

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

  it('returns Find Case Law summaries immediately and hydrates the index after a cache miss', async () => {
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
      hits: [{ neutralCitation: '[2024] UKSC 3' }],
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

  it('continues to Find Case Law when stored search is unavailable', async () => {
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
      hits: [{ id: 'uksc-2024-3' }],
    })
  })

  it('continues to Find Case Law when stored search is slow', async () => {
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
      hits: [{ id: 'uksc-2024-3' }],
    })
  })

  it('returns fetched results even when indexing is unavailable', async () => {
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
      hits: [{ id: 'uksc-2024-3' }],
    })
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
    'returns a summary and hydrates the index for $requestCourt',
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
        hits: [{ neutralCitation: citation, court: storedCourt }],
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

  it('returns a summary when background detail hydration fails', async () => {
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
      hits: [{ id: 'uksc-2024-3' }],
    })
    expect(searchClientMock.indexDocuments).not.toHaveBeenCalled()
  })

  it('returns summaries when the local rate limit is exhausted during background hydration', async () => {
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
      hits: [{ id: 'uksc-2024-3' }],
    })
  })

  it('returns Court of Appeal and High Court summaries and hydrates the index', async () => {
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
      hits: [
        { neutralCitation: '[2024] EWCA Civ 7', court: 'ewca-civ' },
        { neutralCitation: '[2026] EWHC 1157 (Admin)', court: 'ewhc-admin' },
      ],
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

  it('returns a retry hint when Find Case Law is rate limited', async () => {
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

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'storage_unavailable' },
      retryAfter: '120',
      cachedHits: [],
    })
  })

  it('returns a clear error when Find Case Law is unavailable', async () => {
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

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'storage_unavailable',
        message: 'Find Case Law is unavailable.',
      },
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

  it('fetches stable d-style Find Case Law document URIs when stored lookup misses', async () => {
    const documentId = 'd-f11e093f-8a53-4e43-8dd8-1531b5d8f018'
    searchClientMock.getDocument.mockRejectedValueOnce(new Error('not found'))
    searchClientMock.indexDocuments.mockResolvedValueOnce({
      indexedCount: 1,
      failedCount: 0,
      errors: [],
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        `<html><body><h1>Jarndyce v Jarndyce</h1><h2><span>Neutral Citation Number</span>[2024] UKSC 123</h2><article><div class="judgment-header__date">Date: 30/04/2025</div><p>This stable URI judgment paragraph is long enough to render.</p></article></body></html>`,
      ),
    )
    const app = createLegalSearchProxyRoutes(env)

    const response = await app.request(`/api/search/documents/${documentId}`)

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: `/${documentId}` }),
    )
    expect(await response.json()).toMatchObject({
      document: {
        id: documentId,
        neutralCitation: '[2024] UKSC 123',
        court: 'uksc',
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

  it('parses Atom fallbacks, encoded content, and malformed-entry skips conservatively', () => {
    expect(
      parseFindCaseLawAtom(
        '<feed><entry><title><![CDATA[Example &amp; Test [2024] UKSC 3]]></title><id>uksc/2024/3</id><updated>2024-01-31T00:00:00Z</updated></entry><entry><title>Missing Citation</title><id>/uksc/2024/4</id><updated>2024-01-31T00:00:00Z</updated></entry></feed>',
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
        hits: [expect.objectContaining({ neutralCitation: citation, court: storedCourt })],
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
