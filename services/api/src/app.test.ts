import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from './app'
import { createAuth } from './auth'
import type { ApiEnv } from './env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  search: vi.fn(),
}))

vi.mock('@ormont/search-client', () => searchClientMock)

type Auth = ReturnType<typeof createAuth>
type QueryMock = (...args: unknown[]) => Promise<unknown>

interface ErrorBody {
  error: {
    code: string
    message: string
    requestId: string
  }
}

const testEnv: ApiEnv = {
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

function createPool(query: QueryMock): Pool {
  return {
    query,
  } as unknown as Pool
}

function createConnectedPool(query: QueryMock): Pool {
  return {
    connect: async () => ({
      query,
      release: () => undefined,
    }),
  } as unknown as Pool
}

describe('createApiApp', () => {
  it('returns changelog entries from GitHub releases', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            html_url: 'https://github.com/OrmontLex/ormont/releases/tag/v1',
            name: 'Initial search release',
            published_at: '2026-05-22T10:00:00Z',
            tag_name: 'v1',
          },
        ]),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createApiApp(testEnv, createPool(async () => ({ rows: [] })), {
      auth,
    })

    try {
      const response = await app.request('/api/changelog')
      const body = await response.json() as {
        entries: Array<{ date: string; title: string; url: string }>
        source: string
      }

      expect(response.status).toBe(200)
      expect(body).toEqual({
        entries: [
          {
            date: '2026-05-22',
            title: 'Initial search release',
            url: 'https://github.com/OrmontLex/ormont/releases/tag/v1',
          },
        ],
        source: 'github_releases',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns the shared error shape when session loading throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const auth = {
      api: {
        getSession: async () => {
          throw new Error('database unavailable')
        },
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(testEnv, createPool(async () => ({ rows: [] })), {
      auth,
    })

    try {
      const response = await app.request('/api/me')
      const body = (await response.json()) as ErrorBody

      expect(response.status).toBe(500)
      expect(body).toMatchObject({
        error: {
          code: 'storage_unavailable',
          message: 'The API could not complete the request.',
        },
      })
      expect(body.error.requestId).toMatch(/^req_/)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('allows the configured desktop origin through CORS', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(testEnv, createPool(async () => ({ rows: [] })), {
      auth,
    })

    const response = await app.request('/api/health', {
      headers: {
        Origin: 'ormont://desktop-auth',
      },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe(
      'ormont://desktop-auth',
    )
  })

  it('creates matters for the signed-in organisation', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: {
            id: 'ses_1',
          },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        return {
          rows: [
            {
              id: 'mtr_1',
              organisation_id: 'org_1',
              name: 'Share purchase',
              description: null,
              primary_jurisdiction: 'england_and_wales',
              secondary_jurisdictions: [],
              legal_domains: ['corporate'],
              client_reference: '',
              status: 'active',
              created_by: 'usr_1',
              deleted_at: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }
      }),
      { auth },
    )

    const response = await app.request('/api/matters', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Share purchase',
        primaryJurisdiction: 'england_and_wales',
        legalDomains: ['corporate'],
      }),
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      matter: {
        id: 'mtr_1',
        organisationId: 'org_1',
        name: 'Share purchase',
      },
    })
    expect(queries[0]).toEqual([
      expect.stringContaining('insert into matters'),
      [
        'org_1',
        'Share purchase',
        null,
        'england_and_wales',
        '[]',
        '["corporate"]',
        '',
        'usr_1',
      ],
    ])
  })

  it('lists matters from the signed-in organisation', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: {
            id: 'ses_1',
          },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const queries: unknown[] = []
    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/matters')

    expect(response.status).toBe(200)
    expect(queries[0]).toEqual([
      expect.stringContaining('from matters'),
      ['org_1', false],
    ])
  })

  it('rejects generic matter updates that try to delete matters', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: {
            id: 'ses_1',
          },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const queries: unknown[] = []
    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/matters/mtr_1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'deleted' }),
      headers: {
        'content-type': 'application/json',
      },
    })
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'validation_failed',
      message: 'Use DELETE /api/matters/:id to delete matters.',
    })
    expect(queries).toHaveLength(0)
  })

  it('audits matter restore actions transactionally', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: {
            id: 'ses_1',
          },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const queries: unknown[] = []
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        const sql = String(args[0])

        if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
          return { rows: [] }
        }
        if (sql.includes('update matters')) {
          return {
            rows: [
              {
                id: 'mtr_1',
                organisation_id: 'org_1',
                name: 'Share purchase',
                description: null,
                primary_jurisdiction: 'england_and_wales',
                secondary_jurisdictions: [],
                legal_domains: ['corporate'],
                client_reference: '',
                status: 'active',
                created_by: 'usr_1',
                deleted_at: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          }
        }

        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/matters/mtr_1/restore', {
      method: 'PATCH',
    })

    expect(response.status).toBe(200)
    expect(queries.map((args) => String((args as unknown[])[0]).trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'begin',
      'update matters set',
      'insert into audit_logs',
      'commit',
    ])
    expect(queries[2]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      expect.arrayContaining(['org_1', 'usr_1', 'matter', 'mtr_1', 'matter.restore', '{}']),
    ])
  })

  it('audits successful Better Auth sign-out on the server route', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.com',
            name: 'User Example',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: {
            id: 'ses_1',
          },
        }),
      },
      handler: async () => Response.json({ success: true }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        'user-agent': 'vitest',
      },
    })

    expect(response.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      expect.arrayContaining([
        'org_1',
        'usr_1',
        'session',
        'ses_1',
        'auth.sign_out',
      ]),
    ])
  })

  it('searches Atlas with validated query filters', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [
        {
          id: 'uksc-2024-1',
          title: 'Potanina v Potanin',
          neutralCitation: '[2024] UKSC 1',
          court: 'uksc',
          jurisdiction: 'england-and-wales',
          dateDecided: '2024-01-31',
          sourceType: 'judgment',
          sourceUrl: 'https://www.supremecourt.uk/cases/uksc-2024-001.html',
          paragraphs: [
            {
              id: 'uksc-2024-1-p1',
              documentId: 'uksc-2024-1',
              paragraphNumber: 1,
              text: 'This paragraph should be fetched through the paragraph endpoint.',
            },
          ],
        },
      ],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    })
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(testEnv, createPool(async () => ({ rows: [] })), {
      auth,
    })

    const response = await app.request(
      '/api/search?q=Potanina&court=uksc&jurisdiction=england-and-wales&dateFrom=2024-01-01&dateTo=2024-12-31&sourceType=judgment',
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      hits: Array<Record<string, unknown>>
      estimatedTotalHits: number
    }
    expect(body).toMatchObject({
      hits: [{ neutralCitation: '[2024] UKSC 1' }],
      estimatedTotalHits: 1,
    })
    expect(body.hits[0]).not.toHaveProperty('paragraphs')
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'atlas_authorities',
      'Potanina',
      {
        court: 'uksc',
        jurisdiction: 'england-and-wales',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        sourceType: 'judgment',
      },
    )
  })

  it('rejects invalid Atlas search query params', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(testEnv, createPool(async () => ({ rows: [] })), {
      auth,
    })

    const response = await app.request(
      '/api/search?q=&dateFrom=not-a-date&sourceType=legislation',
    )
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
    expect(searchClientMock.search).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '',
      expect.anything(),
    )
  })

  it('rejects malformed Atlas metadata filter values before search', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(testEnv, createPool(async () => ({ rows: [] })), {
      auth,
    })
    searchClientMock.search.mockClear()

    const invalidFilterValues = [
      ['court', 'uksc" OR court = "bad'],
      ['court', 'uksc\\'],
      ['court', 'uksc OR court'],
      ['jurisdiction', 'england-and-wales"'],
      ['jurisdiction', 'england-and-wales\\'],
      ['jurisdiction', 'england-and-wales AND judgment'],
    ]

    for (const [param, value] of invalidFilterValues) {
      const response = await app.request(
        `/api/search?q=Potanina&${param}=${encodeURIComponent(value)}`,
      )
      const body = (await response.json()) as ErrorBody

      expect(response.status).toBe(400)
      expect(body.error.code).toBe('validation_failed')
    }

    expect(searchClientMock.search).not.toHaveBeenCalled()
  })
})
