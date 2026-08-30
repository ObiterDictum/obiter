import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from '../app'
import type { createAuth } from '../auth'
import type { ApiEnv } from '../env'

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

const testEnv: ApiEnv = {
  databaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
  authSecret: 'dev-only-better-auth-secret',
  authBaseUrl: 'http://localhost:8787',
  webOrigin: 'http://localhost:3000',
  marketingOrigin: null,
  desktopOrigin: 'obiter://desktop-auth',
  resendApiKey: null,
  emailFrom: 'onboarding@resend.dev',
  meilisearchHost: 'http://localhost:7700',
  meilisearchSearchApiKey: 'dev-key',
  meilisearchAdminApiKey: 'dev-key',
  legalAuthoritiesIndex: 'legal_authorities',
  mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
  mojFindCaseLawRateLimit: 1000,
  rampartModel: 'qarlus/rampart',
  rampartRevision: 'c3221c5cd838eb69a249ab40f8b442483865f233',
  rampartCacheDir: '/tmp/rampart-cache',
  rampartMinScore: 0.4,
  rampartChunkTokens: 400,
  port: 8787,
  nodeEnv: 'test',
}

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
  it('allows anonymous callers on search and changelog routes', async () => {
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

      expect(search.status).toBe(200)
      expect(fetchSearch.status).toBe(200)
      expect(document.status).toBe(200)
      expect(changelog.status).toBe(200)
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
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
