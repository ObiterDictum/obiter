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
})
