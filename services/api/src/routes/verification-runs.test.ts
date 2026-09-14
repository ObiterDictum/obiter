import { Hono } from 'hono'
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  apiErrorResponseSchema,
  verificationRunListResponseSchema,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { queryDouble, queryResult } from '../query-double.test-support'
import { createVerificationRunRoutes } from './verification-runs'

/** A query double answering with no rows, satisfying the real QueryResult
 * contract rather than an incomplete shape. */
function emptyQuery(): Pool['query'] {
  return queryDouble(() => queryResult([])).pool.query
}

function app(query: Pool['query']) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_verify')
    context.set('user', {
      id: 'usr_1',
      organisationId: 'org_1',
      role: 'owner',
    })
    await next()
  })
  routes.route(
    '/',
    createVerificationRunRoutes({ query } as Pool, {
      readText: async () => {
        throw new Error('route tests must not read storage')
      },
      writeText: async () => undefined,
      readBinary: async () => {
        throw new Error('route tests must not read storage')
      },
      writeBinary: async () => undefined,
      delete: async () => undefined,
    }),
  )
  return routes
}

describe('verification run routes', () => {
  it('rejects a create request without a version id', async () => {
    const response = await app(emptyQuery()).request(
      '/api/documents/doc_1/verification-runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(response.status).toBe(400)
    expect(apiErrorResponseSchema.parse(await response.json())).toMatchObject({
      error: { code: 'validation_failed' },
    })
  })

  it('rejects a create request with an unknown field', async () => {
    const response = await app(emptyQuery()).request(
      '/api/documents/doc_1/verification-runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId: 'ver_1', organisationId: 'org_2' }),
      },
    )
    expect(response.status).toBe(400)
    expect(apiErrorResponseSchema.parse(await response.json())).toMatchObject({
      error: { code: 'validation_failed' },
    })
  })

  it('rejects a create request whose version id is not a string', async () => {
    const response = await app(emptyQuery()).request(
      '/api/documents/doc_1/verification-runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId: 42 }),
      },
    )
    expect(response.status).toBe(400)
  })

  it('does not reveal another organisation run by id', async () => {
    const response = await app(emptyQuery()).request(
      '/api/verification-runs/vrun_other',
    )
    expect(response.status).toBe(404)
    const body = apiErrorResponseSchema.parse(await response.json())
    expect(body.error.code).toBe('verification_run_not_found')
    expect(JSON.stringify(body)).not.toContain('org_2')
  })

  it('returns an empty parsed run list for an organisation with none', async () => {
    const response = await app(emptyQuery()).request('/api/verification-runs')
    expect(response.status).toBe(200)
    const body = verificationRunListResponseSchema.parse(await response.json())
    expect(body.runs).toEqual([])
  })
})
