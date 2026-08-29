import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import { SCANNED_PDF_MESSAGE } from './document-extraction'
import type { ApiEnv } from './env'
import type { RedactionRunRow } from './redaction-database'
import { createLocalStorage } from './storage'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  search: vi.fn(),
}))
const configureRedactionDetectorMock = vi.hoisted(() => vi.fn())
const detectRedactionSpansMock = vi.hoisted(() =>
  vi.fn(async (_text: string) => ({
    spans: [],
    detectorVersion: 'rampart-inference@0.1.3-vendored;mode=model+supplement',
    degraded: false,
  })),
)

vi.mock('@obiter/search-client', () => searchClientMock)
vi.mock('./redaction-detection', () => ({
  configureRedactionDetector: configureRedactionDetectorMock,
  detectionMode: (degraded: boolean) =>
    degraded ? 'heuristics+supplement' : 'model+supplement',
  detectRedactionSpans: detectRedactionSpansMock,
}))

type Auth = ReturnType<typeof createAuth>
type QueryMock = (...args: unknown[]) => Promise<{ rows: unknown[] }>

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
  rampartModel: 'qarlus/rampart',
  rampartRevision: 'c3221c5cd838eb69a249ab40f8b442483865f233',
  rampartCacheDir: '/tmp/rampart-cache',
  rampartMinScore: 0.4,
  rampartChunkTokens: 400,
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

function createHybridPool(query: QueryMock, transactionQuery: QueryMock): Pool {
  return {
    query,
    connect: async () => ({
      query: transactionQuery,
      release: () => undefined,
    }),
  } as unknown as Pool
}

describe('createApiApp', () => {
  it('configures redaction detection from ApiEnv while building the app', () => {
    configureRedactionDetectorMock.mockClear()

    createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth: authWithRole('member'),
      },
    )

    expect(configureRedactionDetectorMock).toHaveBeenCalledExactlyOnceWith({
      model: testEnv.rampartModel,
      revision: testEnv.rampartRevision,
      cacheDir: testEnv.rampartCacheDir,
      minScore: testEnv.rampartMinScore,
      chunkTokens: testEnv.rampartChunkTokens,
    })
  })

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

  it('mounts the document comments router behind session authentication', async () => {
    const auth = {
      api: { getSession: async () => null },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createPool(async () => {
        throw new Error('Comments must authenticate before database access.')
      }),
      { auth },
    )

    const response = await app.request('/api/documents/doc_1/comments')

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
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

  it('auto-provisions a personal workspace when an org-less user hits Matters', async () => {
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
      createHybridPool(
        async (sql) => {
          if (String(sql).includes('from matters')) {
            return { rows: [] }
          }
          return { rows: [] }
        },
        async (...args) => {
          const sql = String(args[0])
          if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
            return { rows: [] }
          }
          if (sql.includes('select "organisationId"')) {
            return { rows: [{ organisationId: null, role: null }] }
          }
          if (sql.includes('insert into organisations')) {
            return {
              rows: [
                {
                  id: 'org_personal',
                  name: 'Personal workspace',
                  plan: 'private_beta',
                },
              ],
            }
          }
          return { rows: [] }
        },
      ),
      { auth },
    )

    const response = await app.request('/api/matters')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ matters: [] })
  })

  it('mounts share routes and provisions an org-less session user', async () => {
    const getSession = vi.fn(async () => ({
      user: { id: 'usr_2', organisationId: null },
      session: { id: 'ses_2' },
    }))
    const auth = {
      api: { getSession },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const directQueries: unknown[][] = []
    const provisioningQueries: string[] = []
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (...args) => {
          directQueries.push(args)
          const sql = String(args[0])
          if (sql.includes('from matters')) {
            return {
              rows: [
                {
                  id: 'mtr_1',
                  organisation_id: 'org_personal',
                  name: 'Personal matter',
                  description: null,
                  primary_jurisdiction: 'england_and_wales',
                  secondary_jurisdictions: [],
                  legal_domains: [],
                  client_reference: '',
                  status: 'active',
                  created_by: 'usr_2',
                  created_at: '2026-08-10T10:00:00.000Z',
                  updated_at: '2026-08-10T10:00:00.000Z',
                  deleted_at: null,
                  deleted_by: null,
                },
              ],
            }
          }
          if (sql.includes('from matter_shares')) return { rows: [] }
          return { rows: [] }
        },
        async (...args) => {
          const sql = String(args[0])
          provisioningQueries.push(sql)
          if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
            return { rows: [] }
          }
          if (sql.includes('select "organisationId"')) {
            return { rows: [{ organisationId: null, role: null }] }
          }
          if (sql.includes('insert into organisations')) {
            return {
              rows: [
                {
                  id: 'org_personal',
                  name: 'Personal workspace',
                  plan: 'private_beta',
                },
              ],
            }
          }
          return { rows: [] }
        },
      ),
      { auth },
    )

    const response = await app.request('/api/matters/mtr_1/shares')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ownerUserId: 'usr_2',
      shares: [],
    })
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(provisioningQueries).toContainEqual(
      expect.stringContaining('insert into organisations'),
    )
    expect(directQueries).toEqual([
      [
        expect.stringContaining('from matters'),
        ['mtr_1', 'org_personal', false, 'usr_2', 'edit'],
      ],
      [
        expect.stringContaining('from matter_shares'),
        ['org_personal', 'mtr_1'],
      ],
    ])
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
        if (sql.includes('select "organisationId"')) {
          return { rows: [{ organisationId: null, role: null }] }
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
        if (sql.includes('select "organisationId"')) {
          return { rows: [{ organisationId: 'org_existing', role: 'owner' }] }
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
      ['org_1', false, 'usr_1'],
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
            role: 'owner',
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
        if (
          sql.includes('for update') &&
          sql.includes('deleted_at is not null')
        ) {
          return { rows: [{ deleted_at: '2026-02-01T00:00:00.000Z' }] }
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
                deleted_by: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          }
        }
        // Cascade-restore matches deleted_at = T; no children in this fixture.
        if (
          sql.includes('update matter_documents') ||
          sql.includes('update redaction_runs')
        ) {
          return { rows: [] }
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
      'select matter.deleted_at::text from',
      'update matters set',
      'update matter_documents set',
      'update redaction_runs set',
      'insert into audit_logs',
      'commit',
    ])
    expect(queries[5]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      expect.arrayContaining([
        'org_1',
        'usr_1',
        'matter',
        'mtr_1',
        'matter.restore',
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
    const root = await mkdtemp(join(tmpdir(), 'obiter-redaction-upload-'))
    const stored = new Map<string, string>()
    const localStorage = createLocalStorage(root)
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
                detector_version:
                  'rampart-inference@0.1.3-vendored;mode=model+supplement',
                detection_mode: 'model+supplement',
                replaces_run_id: null,
                replacement_run_id: null,
                created_by: 'usr_1',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
                deleted_at: null,
                deleted_by: null,
              },
            ],
          }
        }
        return { rows: [] }
      }),
      {
        auth,
        storage: {
          ...localStorage,
          readText: async (key) =>
            stored.get(key) ?? localStorage.readText(key),
          writeText: async (key, text) => {
            stored.set(key, text)
            await localStorage.writeText(key, text)
          },
          delete: async (key) => {
            stored.delete(key)
            await localStorage.delete(key)
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
      run: {
        id: 'red_1',
        sourceFilename: 'source.txt',
        matterId: null,
        detectionMode: 'model+supplement',
      },
    })

    const form = new FormData()
    const pdfFixture = await readFile(
      '../../data/evals/redact/pdf-text-layer-fixture.pdf',
    )
    form.set(
      'file',
      new File([pdfFixture], 'uploaded.pdf', { type: 'application/pdf' }),
    )
    form.set('fileType', 'application/pdf')
    const uploadResponse = await app.request('/api/redaction-runs', {
      method: 'POST',
      body: form,
    })

    expect(uploadResponse.status).toBe(201)
    expect(await uploadResponse.json()).toMatchObject({
      run: {
        id: 'red_1',
        sourceFilename: 'source.txt',
        matterId: null,
        detectionMode: 'model+supplement',
      },
    })

    const demoFixture = await readFile(
      '../../data/evals/redact/demo-fixture.docx',
    )
    const demoForm = new FormData()
    demoForm.set(
      'file',
      new File([demoFixture], 'demo-fixture.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    )
    demoForm.set('fileType', 'docx')

    const demoResponse = await app.request('/api/redaction-runs', {
      method: 'POST',
      body: demoForm,
    })

    expect(demoResponse.status).toBe(201)

    const emptyResponse = await app.request('/api/redaction-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'empty.txt', text: '' }),
    })

    expect(emptyResponse.status).toBe(201)
    expect([...stored.values()]).toEqual([
      'Synthetic test text.',
      expect.stringContaining('amina.rahman@example.test'),
      expect.stringContaining('"version":2'),
      expect.stringContaining('Mr James Cartwright'),
      '',
    ])
    await rm(root, { recursive: true, force: true })
  })

  it('persists degraded detection mode and returns it from run reads', async () => {
    detectRedactionSpansMock.mockResolvedValueOnce({
      spans: [],
      detectorVersion:
        'rampart-inference@0.1.3-vendored;mode=heuristics+supplement',
      degraded: true,
    })
    let persistedMode: unknown
    const row = () => ({
      id: 'red_degraded',
      organisation_id: 'org_1',
      matter_id: 'mtr_1',
      matter_name: 'Synthetic matter',
      document_id: 'doc_1',
      document_version_id: 'ver_1',
      source_filename: 'source.txt',
      source_text_object_key: 'org/org_1/redaction-runs/red_degraded/source',
      status: 'ready_for_review',
      policy_mode: 'internal_ai_minimisation',
      spans_json: [],
      decisions_json: {},
      output_artifact_id: null,
      summary_json: {},
      detector_version:
        'rampart-inference@0.1.3-vendored;mode=heuristics+supplement',
      detection_mode: persistedMode,
      replaces_run_id: null,
      replacement_run_id: null,
      created_by: 'usr_1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
      deleted_by: null,
    })
    const app = createApiApp(
      testEnv,
      createPool(async (sql, params) => {
        const text = String(sql)
        if (text.includes('insert into redaction_runs')) {
          persistedMode = (params as unknown[])[14]
          return { rows: [row()] }
        }
        if (text.includes('from redaction_runs')) return { rows: [row()] }
        return { rows: [] }
      }),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => 'Synthetic text.',
          writeText: async () => undefined,
          delete: async () => undefined,
        },
      },
    )

    const createResponse = await app.request('/api/redaction-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'source.txt', text: 'Synthetic text.' }),
    })
    expect(createResponse.status).toBe(201)
    expect(persistedMode).toBe('heuristics+supplement')
    expect(await createResponse.json()).toMatchObject({
      run: { detectionMode: 'heuristics+supplement' },
    })

    const detailResponse = await app.request('/api/redaction-runs/red_degraded')
    expect(detailResponse.status).toBe(200)
    expect(await detailResponse.json()).toMatchObject({
      run: { detectionMode: 'heuristics+supplement' },
    })

    const listResponse = await app.request(
      '/api/documents/doc_1/redaction-runs',
    )
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toMatchObject({
      runs: [{ detectionMode: 'heuristics+supplement' }],
    })

    const genericListResponse = await app.request('/api/redaction-runs')
    expect(genericListResponse.status).toBe(200)
    expect(await genericListResponse.json()).toMatchObject({
      runs: [{ detectionMode: 'heuristics+supplement' }],
    })
  })

  it('creates an auditable model-detected replacement from a finalized degraded run', async () => {
    const stagedObjects = new Map<string, string>()
    const transactionQueries: string[] = []
    const sourceRun = finalizedRunRow({
      detection_mode: 'heuristics+supplement',
      replaces_run_id: null,
    })
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          const text = String(sql)
          if (text.includes('and run.replaces_run_id = $2')) return { rows: [] }
          if (text.includes('from redaction_runs run')) {
            return { rows: [sourceRun] }
          }
          return { rows: [] }
        },
        async (sql, params) => {
          const text = String(sql)
          transactionQueries.push(text)
          if (text === 'begin' || text === 'commit') return { rows: [] }
          if (text.includes('for update of run')) return { rows: [sourceRun] }
          if (text.includes('run.replaces_run_id')) return { rows: [] }
          if (text.includes('insert into redaction_runs')) {
            // Reconstruct the created row from the mocked insert params; the
            // params are unknown at this boundary, so cast to the row types.
            const values = params as unknown[]
            return {
              rows: [
                finalizedRunRow({
                  id: values[0] as string,
                  status: 'ready_for_review',
                  output_artifact_id: null,
                  source_text_object_key: values[6] as string,
                  detector_version: values[13] as string | null,
                  detection_mode: values[14],
                  replaces_run_id: values[15] as string | null,
                }),
              ],
            }
          }
          if (text.includes('insert into audit_logs')) return { rows: [] }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => 'Exact stored source.',
          writeText: async (key, text) => {
            stagedObjects.set(key, text)
          },
          delete: async (key) => {
            stagedObjects.delete(key)
          },
        },
      },
    )

    const response = await app.request('/api/redaction-runs/red_1/redetect', {
      method: 'POST',
    })
    const body = (await response.json()) as {
      run: { id: string; detectionMode: string; replacesRunId: string }
      redetectedFromRunId: string
    }

    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe(
      `/api/redaction-runs/${body.run.id}`,
    )
    expect(body).toMatchObject({
      run: {
        detectionMode: 'model+supplement',
        replacesRunId: 'red_1',
      },
      redetectedFromRunId: 'red_1',
    })
    expect([...stagedObjects.values()]).toEqual(['Exact stored source.'])
    expect(
      transactionQueries.filter((sql) =>
        sql.includes('insert into audit_logs'),
      ),
    ).toHaveLength(2)
    expect(
      transactionQueries.some((sql) => sql.includes('update redaction_runs')),
    ).toBe(false)
  })

  it('returns redaction_model_unavailable without creating a replacement when retry still degrades', async () => {
    detectRedactionSpansMock.mockResolvedValueOnce({
      spans: [],
      detectorVersion:
        'rampart-inference@0.1.3-vendored;mode=heuristics+supplement',
      degraded: true,
    })
    const writes: string[] = []
    const app = createApiApp(
      testEnv,
      createPool(async (sql) => {
        const text = String(sql)
        if (text.includes('and run.replaces_run_id = $2')) return { rows: [] }
        if (text.includes('from redaction_runs run')) {
          return {
            rows: [
              finalizedRunRow({ detection_mode: 'heuristics+supplement' }),
            ],
          }
        }
        return { rows: [] }
      }),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => 'Exact stored source.',
          writeText: async (key) => {
            writes.push(key)
          },
          delete: async () => undefined,
        },
      },
    )

    const response = await app.request('/api/redaction-runs/red_1/redetect', {
      method: 'POST',
    })

    expect(response.status).toBe(503)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_model_unavailable',
    )
    expect(writes).toEqual([])
  })

  it('maps unrecoverable detector errors to redaction_detection_failed', async () => {
    detectRedactionSpansMock.mockRejectedValueOnce(
      new Error('unrecoverable detection failure'),
    )
    const deletedKeys: string[] = []
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => 'Synthetic text.',
          writeText: async () => undefined,
          delete: async (key) => {
            deletedKeys.push(key)
          },
        },
      },
    )

    const response = await app.request('/api/redaction-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'source.txt', text: 'Synthetic text.' }),
    })

    expect(response.status).toBe(500)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_detection_failed',
    )
    expect(deletedKeys).toHaveLength(1)
  })

  it('returns a validation error for unreadable redaction uploads', async () => {
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const form = new FormData()
    form.set(
      'file',
      new File(['%PDF-corrupt'], 'corrupt.pdf', { type: 'application/pdf' }),
    )
    form.set('fileType', 'application/pdf')

    const response = await app.request('/api/redaction-runs', {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    // A wrapped library failure must not reach the client verbatim.
    expect(body.error.message).toBe(
      'Document text could not be read for redaction.',
    )
  })

  it('tells the uploader a scanned PDF needs OCR rather than a generic read failure', async () => {
    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const fixture = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    const form = new FormData()
    form.set(
      'file',
      new File([fixture], 'scanned.pdf', { type: 'application/pdf' }),
    )
    form.set('fileType', 'application/pdf')

    const response = await app.request('/api/redaction-runs', {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.message).toBe(SCANNED_PDF_MESSAGE)
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

function authWithRole(role: string | null): Auth {
  return {
    api: {
      getSession: async () => ({
        user: { id: 'usr_1', organisationId: 'org_1', role },
        session: { id: 'ses_1' },
      }),
    },
    handler: async () => new Response(null, { status: 404 }),
  } as unknown as Auth
}

const deletedMatterRow = {
  id: 'mtr_1',
  organisation_id: 'org_1',
  name: 'Share purchase',
  description: null,
  primary_jurisdiction: 'england_and_wales',
  secondary_jurisdictions: [],
  legal_domains: [],
  client_reference: '',
  status: 'deleted',
  created_by: 'usr_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: '2026-02-01T00:00:00.000Z',
  deleted_by: 'usr_1',
}

const deletedDocumentRow = {
  id: 'doc_1',
  organisation_id: 'org_1',
  matter_id: 'mtr_1',
  current_version_id: null,
  logical_key: 'doc_logical_1',
  created_by: 'usr_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: '2026-02-01T00:00:00.000Z',
  deleted_by: 'usr_1',
}

const liveMatterRow = {
  ...deletedMatterRow,
  status: 'active',
  deleted_at: null,
  deleted_by: null,
}

const liveDocumentRow = {
  ...deletedDocumentRow,
  deleted_at: null,
  deleted_by: null,
}

function finalizedRunRow(
  overrides: Partial<RedactionRunRow> = {},
): RedactionRunRow {
  return {
    id: 'red_1',
    organisation_id: 'org_1',
    matter_id: null,
    matter_name: null,
    document_id: null,
    document_version_id: null,
    source_filename: 'source.txt',
    source_text_object_key: 'org/org_1/redaction-runs/red_1/source',
    source_file_object_key: null,
    source_layout_object_key: null,
    source_mime_type: null,
    status: 'finalized',
    policy_mode: 'internal_ai_minimisation',
    spans_json: [],
    decisions_json: {},
    output_artifact_id: 'art_1',
    summary_json: { totalSpans: 0 },
    detector_version: null,
    detection_mode: 'model+supplement',
    replaces_run_id: null,
    replacement_run_id: null,
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

describe('createApiApp redaction review reads', () => {
  function createRedactionReadApp({
    run,
    artifactKey = null,
    documentTextKey = null,
    storedText = 'Stored redaction text.',
    auth = authWithRole('member'),
  }: {
    run: ReturnType<typeof finalizedRunRow> | null
    artifactKey?: string | null
    documentTextKey?: string | null
    storedText?: string
    auth?: Auth
  }) {
    const auditWrites: Array<{
      action: string
      metadata: Record<string, unknown>
    }> = []
    const readText = vi.fn(async () => storedText)
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql, params) => {
          const text = String(sql)
          const values = params as unknown[]
          if (text.includes('from redaction_runs')) {
            const visible =
              run && values[0] === run.id && values[1] === run.organisation_id
            return { rows: visible ? [run] : [] }
          }
          if (text.includes('from document_versions')) {
            return {
              rows: documentTextKey
                ? [{ text_object_key: documentTextKey }]
                : [],
            }
          }
          if (text.includes('from artifacts')) {
            return {
              rows: artifactKey ? [{ object_key: artifactKey }] : [],
            }
          }
          if (text.includes('insert into audit_logs')) {
            auditWrites.push({
              action: String(values[4]),
              metadata: JSON.parse(String(values[5])) as Record<
                string,
                unknown
              >,
            })
            return { rows: [] }
          }
          return { rows: [] }
        },
        async (...args) => {
          const sql = String(args[0])
          if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
            return { rows: [] }
          }
          if (sql.includes('select "organisationId"')) {
            return { rows: [{ organisationId: null, role: null }] }
          }
          if (sql.includes('insert into organisations')) {
            return {
              rows: [
                {
                  id: 'org_personal',
                  name: 'Personal workspace',
                  plan: 'private_beta',
                },
              ],
            }
          }
          if (sql.includes('insert into audit_logs')) {
            return { rows: [] }
          }
          return { rows: [] }
        },
      ),
      {
        auth,
        storage: {
          readText,
          writeText: async () => undefined,
          delete: async () => undefined,
        },
      },
    )
    return { app, auditWrites, readText }
  }

  it('guards document text reads for unauthenticated users; org-less users are provisioned', async () => {
    const unauthenticatedAuth = {
      api: { getSession: async () => null },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const organisationlessAuth = {
      api: {
        getSession: async () => ({
          user: { id: 'usr_1', organisationId: null, role: null },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const unauthenticated = await createRedactionReadApp({
      run: null,
      auth: unauthenticatedAuth,
    }).app.request('/api/redaction-runs/red_1/document-text')
    const organisationless = await createRedactionReadApp({
      run: null,
      auth: organisationlessAuth,
    }).app.request('/api/redaction-runs/red_1/document-text')

    expect(unauthenticated.status).toBe(401)
    expect(((await unauthenticated.json()) as ErrorBody).error.code).toBe(
      'unauthenticated',
    )
    // Auto-provisioned personal workspace, then unknown run → 404 (not 403).
    expect(organisationless.status).toBe(404)
    expect(((await organisationless.json()) as ErrorBody).error.code).toBe(
      'redaction_run_not_found',
    )
  })

  it('returns 404 for unknown and cross-organisation document text reads', async () => {
    const unknown = createRedactionReadApp({ run: null })
    const crossOrganisation = createRedactionReadApp({
      run: finalizedRunRow({
        id: 'red_cross_org',
        organisation_id: 'org_2',
      }),
    })

    for (const [app, runId] of [
      [unknown.app, 'red_unknown'],
      [crossOrganisation.app, 'red_cross_org'],
    ] as const) {
      const response = await app.request(
        `/api/redaction-runs/${runId}/document-text`,
      )
      expect(response.status).toBe(404)
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        'redaction_run_not_found',
      )
    }
  })

  it('returns 404 when document text has no resolvable object key', async () => {
    const { app } = createRedactionReadApp({
      run: finalizedRunRow({
        source_text_object_key: null,
        document_version_id: 'ver_1',
      }),
    })

    const response = await app.request(
      '/api/redaction-runs/red_1/document-text',
    )

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'document_version_not_found',
    )
  })

  it('returns stored document text', async () => {
    const { app, readText } = createRedactionReadApp({
      run: finalizedRunRow(),
    })

    const response = await app.request(
      '/api/redaction-runs/red_1/document-text',
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      text: 'Stored redaction text.',
    })
    expect(readText).toHaveBeenCalledWith(
      'org/org_1/redaction-runs/red_1/source',
    )
  })

  it('rejects and logs stored layout segments containing non-finite geometry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { app } = createRedactionReadApp({
      run: finalizedRunRow({
        source_layout_object_key: 'org/org_1/redaction-runs/red_1/layout.json',
      }),
      storedText: JSON.stringify({
        version: 2,
        pages: [{ width: 200, height: 200 }],
        segments: [
          {
            start: 0,
            end: 2,
            pageIndex: 0,
            x: 40,
            y: 100,
            width: 12,
            height: 12,
            advances: [Number.NaN, 6],
            glyphWidthOverrides: {},
          },
        ],
      }),
    })

    const response = await app.request('/api/redaction-runs/red_1/layout')
    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'document_version_not_found',
    )
    expect(warn).toHaveBeenCalledWith(
      'Stored document layout validation failed',
      expect.objectContaining({
        runId: 'red_1',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['segments', 0, 'advances', 0] }),
        ]),
      }),
    )
    warn.mockRestore()
  })

  it('returns 404 for an unknown redaction output run', async () => {
    const { app } = createRedactionReadApp({ run: null })

    const response = await app.request('/api/redaction-runs/red_unknown/output')

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_run_not_found',
    )
  })

  it('returns 400 when a redaction run has no output artifact', async () => {
    const { app } = createRedactionReadApp({
      run: finalizedRunRow({ output_artifact_id: null }),
    })

    const response = await app.request('/api/redaction-runs/red_1/output')
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'redaction_run_not_reviewable',
      message: 'This run has not been finalized.',
    })
  })

  it('returns 404 when a redaction output object key is unavailable', async () => {
    const { app } = createRedactionReadApp({ run: finalizedRunRow() })

    const response = await app.request('/api/redaction-runs/red_1/output')

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'artifact_not_found',
    )
  })

  it('returns stored redaction output text', async () => {
    const { app, readText } = createRedactionReadApp({
      run: finalizedRunRow(),
      artifactKey: 'org/org_1/artifacts/art_1',
    })

    const response = await app.request('/api/redaction-runs/red_1/output')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mimeType: 'text/plain',
      filename: 'source-redacted.txt',
      text: 'Stored redaction text.',
    })
    expect(readText).toHaveBeenCalledWith('org/org_1/artifacts/art_1')
  })

  it('returns redacted PDF metadata and binary download bytes', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 redacted')
    const readBinary = vi.fn(async () => pdfBytes)
    const run = finalizedRunRow({
      source_filename: 'brief.pdf',
      summary_json: {
        totalSpans: 1,
        outputMode: 'redacted',
        outputMimeType: 'application/pdf',
        outputFilename: 'brief-redacted.pdf',
      },
    })
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql, params) => {
          const text = String(sql)
          const values = params as unknown[]
          if (text.includes('from redaction_runs')) {
            const visible =
              values[0] === run.id && values[1] === run.organisation_id
            return { rows: visible ? [run] : [] }
          }
          if (text.includes('from artifacts')) {
            return { rows: [{ object_key: 'org/org_1/artifacts/art_1' }] }
          }
          return { rows: [] }
        },
        async () => ({ rows: [] }),
      ),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => {
            throw new Error('text read should not be used for PDF output')
          },
          writeText: async () => undefined,
          readBinary,
          delete: async () => undefined,
        },
      },
    )

    const meta = await app.request('/api/redaction-runs/red_1/output')
    expect(meta.status).toBe(200)
    await expect(meta.json()).resolves.toEqual({
      mimeType: 'application/pdf',
      filename: 'brief-redacted.pdf',
      text: null,
    })

    const file = await app.request('/api/redaction-runs/red_1/output/file')
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('content-disposition')).toContain(
      'brief-redacted.pdf',
    )
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(pdfBytes)
    expect(readBinary).toHaveBeenCalledWith('org/org_1/artifacts/art_1')
  })

  it('returns matter-attached source PDF bytes with a real MIME type and nosniff', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 source')
    const readBinary = vi.fn(async () => pdfBytes)
    const run = finalizedRunRow({
      source_filename: 'brief.pdf',
      document_version_id: 'ver_1',
      source_file_object_key: null,
      source_mime_type: null,
    })
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql, params) => {
          const text = String(sql)
          const values = params as unknown[]
          if (text.includes('from redaction_runs')) {
            const visible =
              values[0] === run.id && values[1] === run.organisation_id
            return { rows: visible ? [run] : [] }
          }
          if (text.includes('from document_versions')) {
            return {
              rows: [
                {
                  object_key:
                    'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
                  filename: 'brief.pdf',
                  file_type: 'pdf',
                },
              ],
            }
          }
          return { rows: [] }
        },
        async () => ({ rows: [] }),
      ),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => {
            throw new Error('text read should not be used for source PDF')
          },
          writeText: async () => undefined,
          readBinary,
          delete: async () => undefined,
        },
      },
    )

    const response = await app.request('/api/redaction-runs/red_1/source-file')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('brief.pdf')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes)
    expect(readBinary).toHaveBeenCalledWith(
      'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
    )
  })

  it('returns text output/file with nosniff', async () => {
    const { app } = createRedactionReadApp({
      run: finalizedRunRow(),
      artifactKey: 'org/org_1/artifacts/art_1',
    })

    const file = await app.request('/api/redaction-runs/red_1/output/file')
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('returns 404 for an unknown token-map run', async () => {
    const { app } = createRedactionReadApp({ run: null })

    const response = await app.request(
      '/api/redaction-runs/red_unknown/token-map',
    )

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_run_not_found',
    )
  })

  it.each<{ name: string; overrides: Partial<RedactionRunRow> }>([
    {
      name: 'the run is not finalized',
      overrides: {
        status: 'ready_for_review',
        summary_json: {
          outputMode: 'pseudonymised',
          tokenMap: { PERSON_1: 'Jane' },
        },
      },
    },
    {
      name: 'the output is redacted',
      overrides: {
        summary_json: {
          outputMode: 'redacted',
          tokenMap: { PERSON_1: 'Jane' },
        },
      },
    },
    {
      name: 'the token map is absent',
      overrides: { summary_json: { outputMode: 'pseudonymised' } },
    },
  ])('returns 400 for a token-map read when $name', async ({ overrides }) => {
    const { app } = createRedactionReadApp({
      run: finalizedRunRow(overrides),
    })

    const response = await app.request('/api/redaction-runs/red_1/token-map')
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'redaction_run_not_reviewable',
      message: 'No pseudonymisation token map exists for this run.',
    })
  })

  it('returns a pseudonymisation token map and audits access', async () => {
    const tokenMap = { PERSON_1: 'Jane', PERSON_2: 'John' }
    const { app, auditWrites } = createRedactionReadApp({
      run: finalizedRunRow({
        summary_json: { outputMode: 'pseudonymised', tokenMap },
      }),
    })

    const response = await app.request('/api/redaction-runs/red_1/token-map')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ tokenMap })
    expect(auditWrites).toEqual([
      {
        action: 'redaction.token_map_access',
        metadata: { tokenCount: 2 },
      },
    ])
  })
})

describe('createApiApp degraded finalization acknowledgement', () => {
  function appForMode(
    detectionMode: 'model+supplement' | 'heuristics+supplement' | 'unknown',
  ) {
    let outputWrites = 0
    let finalizeAuditMetadata: Record<string, unknown> | null = null
    const readyRun = finalizedRunRow({
      status: 'ready_for_review',
      output_artifact_id: null,
      detection_mode: detectionMode,
    })
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          const text = String(sql)
          if (text.includes('from redaction_runs')) {
            return { rows: [readyRun] }
          }
          return { rows: [] }
        },
        async (sql, params) => {
          const text = String(sql)
          if (text === 'begin' || text === 'commit') return { rows: [] }
          if (text.includes('for update of run')) return { rows: [readyRun] }
          if (text.includes('insert into artifacts')) {
            return {
              rows: [
                {
                  id: 'art_1',
                  object_key: 'org/org_1/artifacts/art_1',
                },
              ],
            }
          }
          if (text.includes('update redaction_runs')) return { rows: [] }
          if (text.includes('from redaction_runs')) {
            return {
              rows: [
                finalizedRunRow({
                  detection_mode: detectionMode,
                }),
              ],
            }
          }
          if (text.includes('insert into audit_logs')) {
            finalizeAuditMetadata = JSON.parse(
              String((params as unknown[])[5]),
            ) as Record<string, unknown>
            return { rows: [] }
          }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async () => 'Synthetic text.',
          writeText: async () => {
            outputWrites += 1
          },
          delete: async () => undefined,
        },
      },
    )
    return {
      app,
      outputWrites: () => outputWrites,
      finalizeAuditMetadata: () => finalizeAuditMetadata,
    }
  }

  it('refuses degraded finalization without acknowledgement and permits it with acknowledgement', async () => {
    const degraded = appForMode('heuristics+supplement')

    const refused = await degraded.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as ErrorBody).error.message).toContain(
      'Acknowledge that model detection did not run',
    )
    expect(degraded.outputWrites()).toBe(0)

    const permitted = await degraded.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outputMode: 'redacted',
          degradedDetectionAcknowledged: true,
        }),
      },
    )
    expect(permitted.status).toBe(200)
    expect(degraded.outputWrites()).toBe(1)
    expect(degraded.finalizeAuditMetadata()).toMatchObject({
      detectionMode: 'heuristics+supplement',
      degradedDetectionAcknowledged: true,
    })
  })

  it('requires a truthful acknowledgement when detection provenance is unknown', async () => {
    const unknown = appForMode('unknown')

    const refused = await unknown.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as ErrorBody).error.message).toContain(
      'detection mode was not recorded',
    )
    expect(unknown.outputWrites()).toBe(0)

    const permitted = await unknown.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outputMode: 'redacted',
          unknownDetectionAcknowledged: true,
        }),
      },
    )
    expect(permitted.status).toBe(200)
    expect(unknown.finalizeAuditMetadata()).toMatchObject({
      detectionMode: 'unknown',
      unknownDetectionAcknowledged: true,
    })
  })

  it('does not require degraded acknowledgement for model-detected runs', async () => {
    const normal = appForMode('model+supplement')

    const response = await normal.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )

    expect(response.status).toBe(200)
    expect(normal.outputWrites()).toBe(1)
    expect(normal.finalizeAuditMetadata()).toMatchObject({
      detectionMode: 'model+supplement',
      degradedDetectionAcknowledged: false,
      unknownDetectionAcknowledged: false,
    })
  })

  it('fails closed to text output when stored PDF geometry is invalid', async () => {
    const readyRun = finalizedRunRow({
      status: 'ready_for_review',
      output_artifact_id: null,
      source_filename: 'source.pdf',
      source_mime_type: 'application/pdf',
      source_file_object_key: 'org/org_1/redaction-runs/red_1/original',
      source_layout_object_key: 'org/org_1/redaction-runs/red_1/layout.json',
      spans_json: [
        {
          id: 'span_1',
          start: 0,
          end: 5,
          text: 'Alice',
          category: 'person_name',
          source: 'rampart_model',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
      decisions_json: {
        span_1: {
          decision: 'accept',
          decidedBy: 'usr_1',
          decidedAt: '2026-07-30T00:00:00.000Z',
        },
      },
    })
    let textOutputWrites = 0
    let binaryOutputWrites = 0
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          if (String(sql).includes('from redaction_runs')) {
            return { rows: [readyRun] }
          }
          return { rows: [] }
        },
        async (sql) => {
          const text = String(sql)
          if (text === 'begin' || text === 'commit') return { rows: [] }
          if (text.includes('for update of run')) return { rows: [readyRun] }
          if (text.includes('insert into artifacts')) {
            return {
              rows: [
                {
                  id: 'art_1',
                  object_key: 'org/org_1/artifacts/art_1',
                },
              ],
            }
          }
          if (text.includes('update redaction_runs')) return { rows: [] }
          if (text.includes('from redaction_runs')) {
            return { rows: [finalizedRunRow()] }
          }
          if (text.includes('insert into audit_logs')) return { rows: [] }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      {
        auth: authWithRole('member'),
        storage: {
          readText: async (key) =>
            key.endsWith('/layout.json')
              ? JSON.stringify({
                  version: 2,
                  pages: [{ width: 200, height: 200 }],
                  segments: [
                    {
                      start: 0,
                      end: 5,
                      pageIndex: 0,
                      x: 40,
                      y: 100,
                      width: 30,
                      height: 12,
                      advances: [null, 6, 6, 6, 6],
                      glyphWidthOverrides: {},
                    },
                  ],
                })
              : 'Alice',
          readBinary: async () => Buffer.from('%PDF-invalid'),
          writeText: async () => {
            textOutputWrites += 1
          },
          writeBinary: async () => {
            binaryOutputWrites += 1
          },
          delete: async () => undefined,
        },
      },
    )

    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })

    expect(response.status).toBe(200)
    expect(textOutputWrites).toBe(1)
    expect(binaryOutputWrites).toBe(0)
    expect(log).toHaveBeenCalledWith(
      'redaction_pdf_burn_failed',
      expect.objectContaining({
        reason: 'cover geometry missing for one or more spans',
      }),
    )
    log.mockRestore()
  })
})

describe('createApiApp replaced redaction run guards', () => {
  it('rejects span decisions after a live replacement exists', async () => {
    let updated = false
    const replacedRun = finalizedRunRow({
      status: 'ready_for_review',
      output_artifact_id: null,
      replacement_run_id: 'red_2',
      spans_json: [
        {
          id: 'span_1',
          start: 0,
          end: 4,
          text: 'Jane',
          category: 'person_name',
          source: 'rampart_model',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
    })
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async () => ({ rows: [] }),
        async (sql) => {
          const text = String(sql)
          if (text === 'begin' || text === 'rollback') return { rows: [] }
          if (text.includes('for update of run')) {
            return { rows: [replacedRun] }
          }
          if (text.includes('update redaction_runs')) {
            updated = true
            return { rows: [] }
          }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      { auth: authWithRole('member') },
    )

    const response = await app.request(
      '/api/redaction-runs/red_1/spans/span_1/decision',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'accept' }),
      },
    )

    expect(response.status).toBe(409)
    expect(((await response.json()) as ErrorBody).error).toMatchObject({
      code: 'conflict_detected',
      message: expect.stringContaining('red_2'),
    })
    expect(updated).toBe(false)
  })

  it('reports an already-finalized run before its replacement lineage', async () => {
    const run = finalizedRunRow({ replacement_run_id: 'red_2' })
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          if (String(sql).includes('from redaction_runs')) {
            return { rows: [run] }
          }
          return { rows: [] }
        },
        async (sql) => {
          throw new Error(`Unexpected transaction SQL: ${String(sql)}`)
        },
      ),
      { auth: authWithRole('member') },
    )

    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })

    expect(response.status).toBe(409)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_already_finalized',
    )
  })
})

describe('createApiApp soft-delete write races', () => {
  it('returns 404 when a run is deleted before a span decision locks it', async () => {
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async () => ({ rows: [] }),
        async (sql) => {
          const text = String(sql)
          if (text === 'begin' || text === 'rollback') return { rows: [] }
          if (text.includes('for update of run')) return { rows: [] }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      { auth: authWithRole('owner') },
    )

    const response = await app.request(
      '/api/redaction-runs/red_1/spans/span_1/decision',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'accept' }),
      },
    )

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_run_not_found',
    )
  })

  it('returns 404 and removes staged output when a run is deleted during finalization', async () => {
    const deletedKeys: string[] = []
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          if (String(sql).includes('from redaction_runs')) {
            return {
              rows: [
                finalizedRunRow({
                  status: 'ready_for_review',
                  output_artifact_id: null,
                }),
              ],
            }
          }
          return { rows: [] }
        },
        async (sql) => {
          const text = String(sql)
          if (text === 'begin' || text === 'rollback') return { rows: [] }
          if (text.includes('for update of run')) return { rows: [] }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      {
        auth: authWithRole('owner'),
        storage: {
          readText: async () => 'Synthetic text.',
          writeText: async () => undefined,
          delete: async (key) => {
            deletedKeys.push(key)
          },
        },
      },
    )

    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_run_not_found',
    )
    expect(deletedKeys).toHaveLength(1)
  })

  it('returns document_not_found when a linked run parent is deleted during detection', async () => {
    const directQueries: string[] = []
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          directQueries.push(String(sql))
          if (String(sql).includes('from matter_documents document')) {
            return {
              rows: [
                {
                  matter_id: 'mtr_1',
                  version_id: 'ver_1',
                  filename: 'source.txt',
                  text_object_key: 'org/org_1/text/ver_1',
                },
              ],
            }
          }
          return { rows: [] }
        },
        async (sql) => {
          const text = String(sql)
          if (text === 'begin' || text === 'rollback') return { rows: [] }
          if (text.includes('select matter.id from matters'))
            return { rows: [] }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      {
        auth: authWithRole('owner'),
        storage: {
          readText: async () => 'Synthetic text.',
          writeText: async () => undefined,
          delete: async () => undefined,
        },
      },
    )

    const response = await app.request('/api/documents/doc_1/redaction-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'document_not_found',
    )
    expect(directQueries.some((sql) => sql.includes('audit_logs'))).toBe(false)
  })

  it('returns matter_not_found when a document parent is deleted before insertion', async () => {
    const transactionQueries: string[] = []
    const app = createApiApp(
      testEnv,
      createHybridPool(
        async (sql) => {
          if (String(sql).includes('from matters')) {
            return {
              rows: [
                {
                  ...deletedMatterRow,
                  status: 'active',
                  deleted_at: null,
                  deleted_by: null,
                },
              ],
            }
          }
          return { rows: [] }
        },
        async (sql) => {
          const text = String(sql)
          transactionQueries.push(text)
          if (text === 'begin' || text === 'rollback') return { rows: [] }
          if (text.includes('select matter.id from matters'))
            return { rows: [] }
          throw new Error(`Unexpected SQL: ${text}`)
        },
      ),
      { auth: authWithRole('owner') },
    )

    const response = await app.request('/api/matters/mtr_1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: 'source.txt',
        fileType: 'text/plain',
        sizeBytes: 15,
        contentSha256: 'a'.repeat(64),
      }),
    })

    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'matter_not_found',
    )
    expect(transactionQueries.some((sql) => sql.includes('insert into'))).toBe(
      false,
    )
  })
})

describe('createApiApp deletion authorization', () => {
  it('rejects matter deletion by a member with 403 forbidden', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const response = await app.request('/api/matters/mtr_1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as ErrorBody).error.code).toBe('forbidden')
  })

  it('rejects matter restore by a member with 403 forbidden', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const response = await app.request('/api/matters/mtr_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as ErrorBody).error.code).toBe('forbidden')
  })

  it('rejects document deletion by a member with 403 forbidden', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const response = await app.request('/api/documents/doc_1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(403)
  })

  it('rejects redaction run deletion by a member with 403 forbidden', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const response = await app.request('/api/redaction-runs/red_1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(403)
  })

  it('rejects document restore by a member with 403 forbidden', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const response = await app.request('/api/documents/doc_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(403)
  })

  it('rejects redaction run restore by a member with 403 forbidden', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('member') },
    )
    const response = await app.request('/api/redaction-runs/red_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(403)
  })
})

describe('createApiApp restore routes', () => {
  it('restores a deleted redaction run', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        const sql = String(args[0]).trim()
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback')
          return { rows: [] }
        if (sql.startsWith('select run.matter_id, run.document_id'))
          return {
            rows: [
              { matter_id: null, document_id: null, replaces_run_id: null },
            ],
          }
        if (sql.startsWith('select deleted_at::text'))
          return { rows: [{ deleted_at: '2026-02-01 00:00:00.1+00' }] }
        if (sql.startsWith('update redaction_runs')) return { rows: [] }
        if (sql.startsWith('select run.id'))
          return { rows: [finalizedRunRow({ deleted_at: null })] }
        if (sql.includes('insert into audit_logs')) return { rows: [] }
        throw new Error(`Unexpected SQL: ${sql}`)
      }),
      { auth: authWithRole('owner') },
    )
    const response = await app.request('/api/redaction-runs/red_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { run: { id: string } }).run.id).toBe(
      'red_1',
    )
  })

  it('reports a conflict when a competing replacement is already live', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        const sql = String(args[0]).trim()
        if (sql === 'begin' || sql === 'rollback') return { rows: [] }
        if (sql.startsWith('select run.matter_id, run.document_id'))
          return {
            rows: [
              { matter_id: null, document_id: null, replaces_run_id: 'red_0' },
            ],
          }
        if (sql.startsWith('select deleted_at::text'))
          return { rows: [{ deleted_at: '2026-02-01 00:00:00.1+00' }] }
        if (sql.includes('replaces_run_id = $2'))
          return { rows: [{ id: 'red_2' }] }
        if (sql.startsWith('select id from redaction_runs'))
          return { rows: [{ id: 'red_0' }] }
        throw new Error(`Unexpected SQL: ${sql}`)
      }),
      { auth: authWithRole('owner') },
    )
    const response = await app.request('/api/redaction-runs/red_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(409)
    const body = (await response.json()) as ErrorBody
    expect(body.error.code).toBe('conflict_detected')
    expect(body.error.message).toContain('red_2')
  })

  it('returns 404 when the redaction run is not deleted', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('owner') },
    )
    const response = await app.request('/api/redaction-runs/red_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'redaction_run_not_found',
    )
  })

  it('returns 404 when the document is not deleted', async () => {
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => ({ rows: [] })),
      { auth: authWithRole('owner') },
    )
    const response = await app.request('/api/documents/doc_1/restore', {
      method: 'PATCH',
    })
    expect(response.status).toBe(404)
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'document_not_found',
    )
  })
})

describe('createApiApp deletion cascade and idempotence', () => {
  it('cascades matter deletion to documents and runs, auditing each entity', async () => {
    const queries: unknown[] = []
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        const sql = String(args[0]).trim()
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
          return { rows: [] }
        }
        if (sql.includes('for update') && sql.includes('deleted_at is null')) {
          return { rows: [{ id: 'mtr_1' }] }
        }
        if (sql.startsWith('update matters'))
          return { rows: [deletedMatterRow] }
        if (sql.startsWith('update matter_documents'))
          return { rows: [deletedDocumentRow] }
        if (sql.startsWith('update redaction_runs'))
          return { rows: [{ id: 'red_1' }] }
        if (sql.includes('insert into audit_logs')) return { rows: [] }
        return { rows: [] }
      }),
      { auth: authWithRole('owner') },
    )

    const response = await app.request('/api/matters/mtr_1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(200)
    const auditActions = queries
      .filter((args) => String((args as unknown[])[0]).includes('audit_logs'))
      .map((args) => (args as unknown[])[1] as unknown[])
      .map((params) => params[4])
    expect(auditActions).toEqual([
      'matter.delete',
      'document.delete',
      'redaction_run.delete',
    ])
  })

  it('returns 404 without auditing when deleting an already-deleted matter', async () => {
    const queries: unknown[] = []
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        const sql = String(args[0]).trim()
        if (sql === 'begin' || sql === 'rollback') return { rows: [] }
        // FOR UPDATE finds no live row (matter already deleted).
        if (sql.includes('for update')) return { rows: [] }
        return { rows: [] }
      }),
      { auth: authWithRole('owner') },
    )

    const response = await app.request('/api/matters/mtr_1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(404)
    expect(
      queries.some((args) =>
        String((args as unknown[])[0]).includes('insert into audit_logs'),
      ),
    ).toBe(false)
  })
})

describe('createApiApp includeDeleted authorization', () => {
  const routes = [
    {
      path: '/api/matters',
      normalResponse: { matters: [] },
      deletedResponse: { matters: [{ id: 'mtr_1' }] },
    },
    {
      path: '/api/matters/mtr_1',
      normalResponse: { matter: { id: 'mtr_1', deletedAt: null } },
      deletedResponse: {
        matter: {
          id: 'mtr_1',
          deletedAt: '2026-02-01T00:00:00.000Z',
        },
      },
    },
    {
      path: '/api/matters/mtr_1/documents',
      normalResponse: { documents: [] },
      deletedResponse: { documents: [{ id: 'doc_1' }] },
    },
    {
      path: '/api/documents/doc_1',
      normalResponse: { document: { id: 'doc_1', deletedAt: null } },
      deletedResponse: {
        document: {
          id: 'doc_1',
          deletedAt: '2026-02-01T00:00:00.000Z',
        },
      },
    },
  ]

  function appForIncludeDeletedRead(role: string) {
    return createApiApp(
      testEnv,
      createPool(async (sql, parameters) => {
        const text = String(sql)
        const values = Array.isArray(parameters) ? parameters : []
        const includeDeleted = values.includes(true)

        if (
          text.includes('from matter_documents d\n') &&
          text.includes('order by d.created_at')
        ) {
          return { rows: includeDeleted ? [deletedDocumentRow] : [] }
        }
        if (text.includes('from matter_documents')) {
          return {
            rows: includeDeleted ? [deletedDocumentRow] : [liveDocumentRow],
          }
        }
        if (text.includes('from matters')) {
          if (!text.includes('matter.id = $1'))
            return { rows: includeDeleted ? [deletedMatterRow] : [] }
          return {
            rows: includeDeleted ? [deletedMatterRow] : [liveMatterRow],
          }
        }
        return { rows: [] }
      }),
      { auth: authWithRole(role) },
    )
  }

  for (const { path } of routes) {
    it(`rejects a member requesting includeDeleted from ${path}`, async () => {
      const response = await appForIncludeDeletedRead('member').request(
        `${path}?includeDeleted=true`,
      )

      expect(response.status).toBe(403)
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        'forbidden',
      )
    })
  }

  for (const { path, normalResponse } of routes) {
    it(`keeps the normal member response live-only for ${path}`, async () => {
      const response = await appForIncludeDeletedRead('member').request(path)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject(normalResponse)
    })
  }

  for (const role of ['owner', 'admin']) {
    for (const { path, deletedResponse } of routes) {
      it(`returns deleted rows to an ${role} requesting includeDeleted from ${path}`, async () => {
        const response = await appForIncludeDeletedRead(role).request(
          `${path}?includeDeleted=true`,
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject(deletedResponse)
      })
    }
  }
})

describe('createApiApp deleted-run audit access shape', () => {
  it('returns the audit report of a deleted run to an owner', async () => {
    const app = createApiApp(
      testEnv,
      createPool(async (sql) => {
        if (typeof sql === 'string' && sql.includes('from redaction_runs')) {
          return {
            rows: [
              finalizedRunRow({
                deleted_at: '2026-02-01T00:00:00.000Z',
                deleted_by: 'usr_1',
                detection_mode: 'heuristics+supplement',
              }),
            ],
          }
        }
        if (typeof sql === 'string' && sql.includes('audit_logs')) {
          return { rows: [] }
        }
        return { rows: [] }
      }),
      { auth: authWithRole('owner') },
    )

    const response = await app.request('/api/redaction-runs/red_1/audit')
    expect(response.status).toBe(200)
    const report = (await response.json()) as { detectionMode: string }
    expect(report.detectionMode).toBe('heuristics+supplement')
  })

  it('forbids a member from reading a deleted run audit report', async () => {
    const app = createApiApp(
      testEnv,
      createPool(async (sql) => {
        if (typeof sql === 'string' && sql.includes('from redaction_runs')) {
          return {
            rows: [
              finalizedRunRow({
                deleted_at: '2026-02-01T00:00:00.000Z',
                deleted_by: 'usr_1',
              }),
            ],
          }
        }
        return { rows: [] }
      }),
      { auth: authWithRole('member') },
    )

    const response = await app.request('/api/redaction-runs/red_1/audit')
    expect(response.status).toBe(403)
    expect(((await response.json()) as ErrorBody).error.code).toBe('forbidden')
  })

  it('returns 404 for a direct GET of a deleted run (excluded by default)', async () => {
    const app = createApiApp(
      testEnv,
      createPool(async (sql) => {
        if (typeof sql === 'string' && sql.includes('from redaction_runs')) {
          // Default includeDeleted=false filters the soft-deleted row out.
          return { rows: [] }
        }
        return { rows: [] }
      }),
      { auth: authWithRole('owner') },
    )

    const response = await app.request('/api/redaction-runs/red_1')
    expect(response.status).toBe(404)
  })
})
