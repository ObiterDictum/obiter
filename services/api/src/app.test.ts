import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from './app'
import { createAuth } from './auth'
import type { ApiEnv } from './env'

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

function createPoolWithClient(input: { query: QueryMock; clientQuery: QueryMock }): Pool {
  return {
    query: input.query,
    connect: async () => ({
      query: input.clientQuery,
      release: () => undefined,
    }),
  } as unknown as Pool
}

function matterRow() {
  return {
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
  }
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    current_version_id: null,
    logical_key: 'doc_1',
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    matter_document_id: 'doc_1',
    filename: 'skeleton.pdf',
    file_type: 'application/pdf',
    size_bytes: 1234,
    object_key: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
    text_object_key: null,
    document_status: 'queued',
    failure_reason: null,
    version_number: 1,
    content_sha256: 'a'.repeat(64),
    sync_state: 'synced',
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('createApiApp', () => {
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

  it('audits document metadata creation and initial version creation', async () => {
    const routeQueries: unknown[] = []
    const transactionQueries: unknown[] = []
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
      createPoolWithClient({
        query: async (...args) => {
          routeQueries.push(args)
          const sql = String(args[0])

          if (sql.includes('from matters')) {
            return { rows: [matterRow()] }
          }
          if (sql.includes('insert into audit_logs')) {
            return { rows: [] }
          }
          throw new Error(`Unexpected route SQL: ${sql}`)
        },
        clientQuery: async (...args) => {
          transactionQueries.push(args)
          const sql = String(args[0])

          if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
            return { rows: [] }
          }
          if (sql.includes('insert into matter_documents')) {
            return { rows: [documentRow()] }
          }
          if (sql.includes('insert into document_versions')) {
            const params = args[1] as unknown[]
            return { rows: [versionRow({ id: params[0] })] }
          }
          if (sql.includes('update matter_documents')) {
            const params = args[1] as unknown[]
            return { rows: [documentRow({ current_version_id: params[2] })] }
          }
          throw new Error(`Unexpected transaction SQL: ${sql}`)
        },
      }),
      { auth },
    )

    const response = await app.request('/api/matters/mtr_1/documents', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'skeleton.pdf',
        fileType: 'application/pdf',
        sizeBytes: 1234,
        contentSha256: 'a'.repeat(64),
      }),
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(response.status).toBe(201)
    expect(transactionQueries.map((args) => String((args as unknown[])[0]).trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'begin',
      'insert into matter_documents',
      'insert into document_versions',
      'update matter_documents set',
      'commit',
    ])
    expect(routeQueries.filter((args) => String((args as unknown[])[0]).includes('insert into audit_logs'))).toEqual([
      [
        expect.stringContaining('insert into audit_logs'),
        expect.arrayContaining(['org_1', 'usr_1', 'document', 'doc_1', 'document.upload']),
      ],
      [
        expect.stringContaining('insert into audit_logs'),
        expect.arrayContaining(['org_1', 'usr_1', 'document_version', expect.stringMatching(/^ver_/), 'document.version_create']),
      ],
    ])
  })

  it('audits document soft-delete actions', async () => {
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
        const sql = String(args[0])

        if (sql.includes('update matter_documents')) {
          return { rows: [documentRow({ deleted_at: '2026-01-01T00:01:00.000Z' })] }
        }
        if (sql.includes('insert into audit_logs')) {
          return { rows: [] }
        }
        throw new Error(`Unexpected SQL: ${sql}`)
      }),
      { auth },
    )

    const response = await app.request('/api/documents/doc_1', {
      method: 'DELETE',
    })

    expect(response.status).toBe(200)
    expect(queries).toEqual([
      [
        expect.stringContaining('update matter_documents'),
        ['doc_1', 'org_1'],
      ],
      [
        expect.stringContaining('insert into audit_logs'),
        expect.arrayContaining(['org_1', 'usr_1', 'document', 'doc_1', 'document.delete']),
      ],
    ])
  })
})
