import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from '../app'
import type { createAuth } from '../auth'
import type { ApiEnv } from '../env'
import { createTestApiEnv } from '../test-api-env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  search: vi.fn(),
  getDocument: vi.fn(),
}))

vi.mock('@obiter/search-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@obiter/search-client')>()),
  ...searchClientMock,
}))

vi.mock('../redaction-detection', () => ({
  configureRedactionDetector: vi.fn(),
  detectionMode: () => 'model+supplement',
  detectRedactionSpans: vi.fn(),
}))

type Auth = ReturnType<typeof createAuth>

const testEnv: ApiEnv = createTestApiEnv()

const publicHit = {
  id: 'uksc-2024-3',
  title: 'Potanina v Potanin',
  neutralCitation: '[2024] UKSC 3',
  court: 'uksc',
  jurisdiction: 'england-and-wales',
  dateDecided: '2024-01-31',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
}

describe('deliberately public routes', () => {
  it('allows anonymous callers on deliberately public routes', async () => {
    const auth = {
      api: { getSession: async () => null },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    searchClientMock.search.mockResolvedValue({
      hits: [publicHit],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    searchClientMock.getDocument.mockResolvedValue(publicHit)
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              html_url:
                'https://github.com/ObiterDictum/obiter/releases/tag/v1',
              name: 'Initial search release',
              published_at: '2026-05-22T10:00:00Z',
              tag_name: 'v1',
            },
          ]),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createApiApp(
      testEnv,
      { query: async () => ({ rows: [] }) } as unknown as Pool,
      { auth },
    )

    try {
      const search = await app.request('/api/search?q=Potanina')
      const fetchSearch = await app.request('/api/search/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'Potanina' }),
      })
      const document = await app.request('/api/search/documents/uksc-2024-3')
      const changelog = await app.request('/api/changelog')
      const health = await app.request('/api/health')

      expect(search.status).toBe(200)
      expect(fetchSearch.status).toBe(200)
      expect(document.status).toBe(200)
      expect(changelog.status).toBe(200)
      expect(health.status).toBe(200)
      expect(((await search.json()) as { hits: unknown[] }).hits).toHaveLength(
        1,
      )
      expect(
        ((await fetchSearch.json()) as { hits: unknown[] }).hits,
      ).toHaveLength(1)
      expect(
        ((await document.json()) as { document: { id: string } }).document.id,
      ).toBe('uksc-2024-3')
      expect(((await changelog.json()) as { source: string }).source).toBe(
        'github_releases',
      )
      expect(await health.json()).toEqual({
        status: 'ok',
        service: 'obiter-api',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
