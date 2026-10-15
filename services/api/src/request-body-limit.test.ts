import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { Pool } from 'pg'
import { DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH } from '@obiter/contracts'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import { createTestApiEnv } from './test-api-env'
import { DEFAULT_DOCUMENT_EDIT_MAX_BYTES } from './request-limit-defaults'

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

function matterRow() {
  return {
    id: 'mtr_1',
    organisation_id: 'org_1',
    name: 'Matter',
    description: null,
    primary_jurisdiction: 'england_and_wales',
    secondary_jurisdictions: [],
    legal_domains: [],
    client_reference: '',
    status: 'active',
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
  }
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

  it('classifies malformed multipart as 400 validation_failed without creating a document', async () => {
    const statements: string[] = []
    const query = vi.fn(async (...args: unknown[]) => {
      const sql = String(args[0])
      statements.push(sql)
      if (sql.includes('from matters')) return { rows: [matterRow()] }
      return { rows: [] }
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
    const body = 'this is not multipart at all, honest!'
    const response = await app.request('/api/matters/mtr_1/documents', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=',
        'content-length': String(Buffer.byteLength(body)),
      },
      body,
    })

    expect(response.status).toBe(400)
    const json = (await response.json()) as {
      error: { code: string; message: string; requestId: string }
    }
    expect(json.error.code).toBe('validation_failed')
    expect(json.error.message).toBe(
      'The uploaded form data could not be parsed.',
    )
    expect(json.error.requestId).toMatch(/^req_/)
    expect(
      statements.some((sql) => sql.includes('insert into matter_documents')),
    ).toBe(false)
  })

  it.each([
    '/api/documents/doc_1/edit',
    '/api/documents/doc_1/collaboration/merge',
  ])(
    'admits an edit payload past the 48 KiB JSON limit on %s',
    async (path) => {
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
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversizedJsonBody(),
      })

      // The document resolves to nothing in the stub pool, but the request
      // reached the handler — the edit cap admitted it past the 48 KiB gate.
      expect(response.status).not.toBe(413)
    },
  )

  it.each([
    '/api/documents/doc_1/edit',
    '/api/documents/doc_1/collaboration/merge',
  ])('still bounds the edit routes at %s', async (path) => {
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
      createPool(async () => ({ rows: [] })),
      { auth },
    )
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(DEFAULT_DOCUMENT_EDIT_MAX_BYTES + 1),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: { code: 'payload_too_large' },
    })
  })

  it('keeps other document routes on the 48 KiB JSON limit', async () => {
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
      createPool(async () => ({ rows: [] })),
      { auth },
    )
    const response = await app.request('/api/documents/doc_1/restore', {
      method: 'PATCH',
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
  })

  it('keeps the image contract bound below the edit transport cap', () => {
    expect(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH).toBeLessThan(
      DEFAULT_DOCUMENT_EDIT_MAX_BYTES,
    )
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
