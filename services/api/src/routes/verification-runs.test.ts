import { Hono } from 'hono'
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import type { AuthzVariables } from '../authz'
import { createVerificationRunRoutes } from './verification-runs'

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
    const response = await app(async () => ({ rows: [] })).request(
      '/api/documents/doc_1/verification-runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation_failed' },
    })
  })

  it('does not reveal another organisation run by id', async () => {
    const response = await app(async () => ({ rows: [] })).request(
      '/api/verification-runs/vrun_other',
    )
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe('verification_run_not_found')
    expect(JSON.stringify(body)).not.toContain('org_2')
  })
})
