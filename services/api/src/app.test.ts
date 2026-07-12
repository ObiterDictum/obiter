import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import type { ApiEnv } from './env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  search: vi.fn(),
}))

vi.mock('@obiter/search-client', () => searchClientMock)
vi.mock('./redaction-detection', () => ({
  detectRedactionSpans: async (text: string) => ({
    spans: [],
    detectorVersion: 'rampart-inference@0.1.3-vendored;mode=model+supplement',
    degraded: false,
  }),
}))

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
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )

    try {
      const response = await app.request('/api/changelog')
      const body = (await response.json()) as {
        entries: Array<{ date: string; title: string; url: string }>
        source: string
      }

      expect(response.status).toBe(200)
      expect(body).toEqual({
        entries: [
          {
            date: '2026-05-22',
            title: 'Initial search release',
            url: 'https://github.com/ObiterDictum/obiter/releases/tag/v1',
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

    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )

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

  it('returns 401 from /api/me without a real session', async () => {
    const auth = {
      api: { getSession: async () => null },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )

    const response = await app.request('/api/me')

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthenticated' },
    })
  })

  it('returns the active organisation for a real session at /api/me', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.test',
            name: 'User',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({
        rows: [{ id: 'org_1', name: 'Organisation', plan: 'private_beta' }],
      })),
      { auth },
    )

    const response = await app.request('/api/me')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { id: 'usr_1', role: 'owner' },
      organisation: { id: 'org_1' },
    })
  })

  it('returns the user with organisation null for an org-less session at /api/me', async () => {
    // A freshly registered user has no organisation until they create one.
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_2',
            email: 'new@example.test',
            name: 'New User',
            organisationId: null,
            role: null,
          },
          session: { id: 'ses_2' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )

    const response = await app.request('/api/me')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { id: 'usr_2', role: null },
      organisation: null,
    })
  })

  it('returns 403 no_organisation when an org-less user hits an org-scoped endpoint', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_2', organisationId: null },
          session: { id: 'ses_2' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )

    const response = await app.request('/api/matters')
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('no_organisation')
  })

  it('creates an organisation for an org-less user via POST /api/organisations', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_2', organisationId: null },
          session: { id: 'ses_2' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        const sql = String(args[0])
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback')
          return { rows: [] }
        if (sql.includes('select "organisationId" from users')) {
          return { rows: [{ organisationId: null }] }
        }
        if (sql.includes('insert into organisations')) {
          return {
            rows: [{ id: 'org_new', name: 'Acme Law', plan: 'private_beta' }],
          }
        }
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/organisations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Acme Law  ' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      organisation: { id: 'org_new', name: 'Acme Law' },
    })
    // The name is trimmed before insert, and an audit row is written in the
    // same transaction as the org insert + user update.
    const insertOrg = queries.find((q) =>
      String((q as unknown[])[0]).includes('insert into organisations'),
    ) as unknown[] | undefined
    expect(insertOrg?.[1]).toEqual(['Acme Law'])
    const auditQuery = queries.find((q) =>
      String((q as unknown[])[0]).includes('insert into audit_logs'),
    ) as unknown[] | undefined
    expect(auditQuery).toBeTruthy()
    expect(auditQuery?.[1]).toEqual(
      expect.arrayContaining([
        'org_new',
        'usr_2',
        'organisation',
        'org_new',
        'organisation.create',
      ]),
    )
  })

  it('rejects organisation creation with 409 when the user already has one', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_1', organisationId: 'org_existing' },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        const sql = String(args[0])
        if (sql === 'begin') return { rows: [] }
        if (sql.includes('select "organisationId" from users')) {
          return { rows: [{ organisationId: 'org_existing' }] }
        }
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/organisations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Second Org' }),
    })
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('conflict_detected')
  })

  it('rejects organisation creation with an empty name', async () => {
    const auth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_2', organisationId: null },
          session: { id: 'ses_2' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )

    const response = await app.request('/api/organisations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
  })

  it('rejects a name made only of zero-width / format characters', async () => {
    // \u200b (zero-width space), \u200d (zero-width joiner), \u202e (RLO
    // override) are all category Cf: trim() leaves them, so without stripping
    // they would pass as a non-empty (but invisible) organisation name.
    const auth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_2', organisationId: null },
          session: { id: 'ses_2' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )

    const response = await app.request('/api/organisations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '\u200b\u200d\u202e' }),
    })
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
  })

  it('allows the configured desktop origin through CORS', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )

    const response = await app.request('/api/health', {
      headers: {
        Origin: 'obiter://desktop-auth',
      },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe(
      'obiter://desktop-auth',
    )
  })

  it('allows the electron-vite renderer origin through CORS in development', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(
      { ...testEnv, nodeEnv: 'development' },
      createPool(async () => ({ rows: [] })),
      { auth },
    )

    const response = await app.request('/api/health', {
      headers: {
        Origin: 'http://localhost:5173',
      },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
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
    expect(
      queries.map((args) =>
        String((args as unknown[])[0])
          .trim()
          .split(/\s+/)
          .slice(0, 3)
          .join(' '),
      ),
    ).toEqual([
      'begin',
      'update matters set',
      'insert into audit_logs',
      'commit',
    ])
    expect(queries[2]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      expect.arrayContaining([
        'org_1',
        'usr_1',
        'matter',
        'mtr_1',
        'matter.restore',
        '{}',
      ]),
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

  it('audits an org-less sign-out with a null organisation_id', async () => {
    // Consistent with the nullable audit_logs.organisation_id (migration 0009)
    // and the org-less auth sign-in/sign-up audit rows: an org-less user who
    // signs out must still produce an audit row.
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_orgless',
            email: 'orgless@example.com',
            name: 'Orgless User',
            organisationId: null,
            role: null,
          },
          session: { id: 'ses_orgless' },
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
      headers: { 'user-agent': 'vitest' },
    })

    expect(response.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      expect.arrayContaining([
        null,
        'usr_orgless',
        'session',
        'ses_orgless',
        'auth.sign_out',
      ]),
    ])
  })

  it('searches legal authorities with validated query filters', async () => {
    searchClientMock.search.mockResolvedValueOnce({
      hits: [
        {
          id: 'uksc-2024-3',
          title: 'Potanina v Potanin',
          neutralCitation: '[2024] UKSC 3',
          court: 'uksc',
          jurisdiction: 'england-and-wales',
          dateDecided: '2024-01-31',
          sourceType: 'judgment',
          sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
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
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )

    const response = await app.request(
      '/api/search?q=Potanina&court=ewhc/admin&jurisdiction=england-and-wales&dateFrom=2024-01-01&dateTo=2024-12-31&sourceType=judgment',
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      hits: Array<Record<string, unknown>>
      estimatedTotalHits: number
    }
    expect(body).toMatchObject({
      hits: [{ neutralCitation: '[2024] UKSC 3' }],
      estimatedTotalHits: 1,
    })
    expect(body.hits[0]).not.toHaveProperty('paragraphs')
    expect(searchClientMock.search).toHaveBeenCalledWith(
      { id: 'meili-client' },
      'legal_authorities',
      'Potanina',
      {
        court: 'ewhc-admin',
        jurisdiction: 'england-and-wales',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        sourceType: 'judgment',
      },
      { includeSnippets: true },
    )
  })

  it('rejects invalid legal authority search query params', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )

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

  it('rejects malformed legal authority metadata filter values before search', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )
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

  it('creates an organisation-scoped standalone redaction run and stores its source text', async () => {
    const stored = new Map<string, string>()
    const auth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_1', organisationId: 'org_1' },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async (query) => {
        if (
          typeof query === 'string' &&
          query.includes('insert into redaction_runs')
        ) {
          return {
            rows: [
              {
                id: 'red_1',
                organisation_id: 'org_1',
                matter_id: null,
                matter_name: null,
                document_id: null,
                document_version_id: null,
                source_filename: 'source.txt',
                source_text_object_key: 'org/org_1/redaction-runs/red_1/source',
                status: 'ready_for_review',
                policy_mode: 'internal_ai_minimisation',
                spans_json: [],
                decisions_json: {},
                output_artifact_id: null,
                summary_json: {
                  totalSpans: 0,
                  byCategory: {},
                  bySource: {
                    rampartModel: 0,
                    rampartDeterministic: 0,
                    ukSupplement: 0,
                  },
                  byDecision: {
                    accept: 0,
                    reject: 0,
                    override_redact: 0,
                    override_keep: 0,
                    pseudonymise: 0,
                    undecided: 0,
                  },
                  reviewedCount: 0,
                  unreviewedCount: 0,
                },
                detector_version: null,
                created_by: 'usr_1',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          }
        }
        return { rows: [] }
      }),
      {
        auth,
        storage: {
          readText: async (key) => stored.get(key) ?? '',
          writeText: async (key, text) => {
            stored.set(key, text)
          },
          delete: async (key) => {
            stored.delete(key)
          },
        },
      },
    )

    const response = await app.request('/api/redaction-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: 'source.txt',
        text: 'Synthetic test text.',
      }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      run: { id: 'red_1', sourceFilename: 'source.txt', matterId: null },
    })
    expect([...stored.values()]).toEqual(['Synthetic test text.'])
  })

  it('models future legal source query params without running judgment search', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth,
      },
    )

    const response = await app.request(
      '/api/search?q=section%206&sourceType=legislation_provision&sourceFamily=legislation&legalDomain=human-rights&provider=legislation-gov-uk&topic=Human%20Rights%20Act&asAtDate=2024-01-01&legislationVersion=current',
    )
    const body = (await response.json()) as {
      hits: unknown[]
      outcome: string
    }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      hits: [],
      outcome: 'unsupported_source_type',
    })
    expect(searchClientMock.search).not.toHaveBeenCalled()
  })
})
