import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import { createTestApiEnv } from './test-api-env'

type Auth = ReturnType<typeof createAuth>

const testEnv = createTestApiEnv()

function createPool(
  query: (...args: unknown[]) => Promise<{ rows: unknown[] }>,
): Pool {
  return { query } as unknown as Pool
}

function oversizedJsonBody() {
  return `{"name":"${'A'.repeat(60_000)}","primaryJurisdiction":"england_and_wales"}`
}

function oversizedMultipartBody() {
  return 'x'.repeat(50_000)
}

describe('request body limit middleware', () => {
  it('returns 413 for oversized JSON on POST /api/matters before the handler runs', async () => {
    const query = vi.fn(async () => {
      throw new Error('Database must not be queried for oversized bodies.')
    })
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(testEnv, createPool(query), { auth })
    const response = await app.request('/api/matters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedJsonBody(),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Request body exceeds the 48 KiB JSON limit.',
      },
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 413 for oversized auth sign-in before Better Auth handler runs', async () => {
    let handlerCalled = false
    const handler = vi.fn(async (req: Request) => {
      handlerCalled = true
      await req.text()
      return new Response(null, { status: 404 })
    })
    const auth = {
      api: { getSession: async () => null },
      handler,
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )
    const response = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedJsonBody(),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Request body exceeds the 48 KiB JSON limit.',
      },
    })
    expect(handlerCalled).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps anonymous multipart uploads on the 48 KiB JSON limit', async () => {
    const auth = {
      api: { getSession: async () => null },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async () => ({ rows: [] })),
      { auth },
    )
    const response = await app.request('/api/matters/mtr_1/documents', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      body: oversizedMultipartBody(),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Request body exceeds the 48 KiB JSON limit.',
      },
    })
  })

  it('allows authenticated multipart uploads larger than the JSON limit', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth

    const app = createApiApp(testEnv, createPool(query), { auth })
    const response = await app.request('/api/matters/mtr_1/documents', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      body: oversizedMultipartBody(),
    })

    expect(response.status).not.toBe(413)
  })

  it('still creates a matter when the JSON body is within the limit', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            organisationId: 'org_1',
          },
          session: { id: 'ses_1' },
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
              legal_domains: [],
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Share purchase',
        primaryJurisdiction: 'england_and_wales',
      }),
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
      expect.any(Array),
    ])
  })
})
