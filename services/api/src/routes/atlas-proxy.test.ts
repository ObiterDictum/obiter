import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAtlasProxyRoutes, parseFindCaseLawAtom, parseJudgmentParagraphs } from './atlas-proxy'
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
  atlasAuthoritiesIndex: 'atlas_authorities',
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

beforeEach(() => {
  vi.restoreAllMocks()
  searchClientMock.search.mockReset()
  searchClientMock.indexDocuments.mockReset()
  searchClientMock.getDocument.mockReset()
})

describe('createAtlasProxyRoutes', () => {
  it('returns cached results without calling Find Case Law', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [hit],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createAtlasProxyRoutes(env)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: true,
      hits: [hit],
      indexedCount: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches, parses, indexes, and returns documents on cache miss', async () => {
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
    const app = createAtlasProxyRoutes(env)

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      body: JSON.stringify({ query: 'Potanina', court: 'uksc' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: false,
      indexedCount: 1,
      skippedCount: 0,
      hits: [{ neutralCitation: '[2024] UKSC 3', paragraphs: expect.any(Array) }],
    })
    expect(searchClientMock.indexDocuments).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'atlas_authorities',
      [expect.objectContaining({ id: 'uksc-2024-3' })],
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
    const app = createAtlasProxyRoutes(env)

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
    const app = createAtlasProxyRoutes(env)

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

  it('returns a stored Atlas document by id', async () => {
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
    const app = createAtlasProxyRoutes(env)

    const response = await app.request('/api/search/documents/uksc-2024-1')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      document: { id: 'uksc-2024-1', paragraphs: [{ paragraphNumber: 1 }] },
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
})
