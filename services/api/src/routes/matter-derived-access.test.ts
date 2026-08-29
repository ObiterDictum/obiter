import { Hono } from 'hono'
import type { Pool } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthzVariables } from '../authz'
import type { StorageService } from '../storage'
import { createDocumentAccessRoutes } from './document-access'
import { createDocumentsRoutes } from './documents'
import { createMattersRoutes } from './matters'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import { createRedactReviewRoutes } from './redact-review'
import { createRedactRunCreationRoutes } from './redact-run-creation'

const queries: string[] = []
const query = async (sql: string) => {
  queries.push(sql)
  return { rows: [] }
}
const pool = {
  query,
  connect: async () => ({ query, release: () => undefined }),
} as unknown as Pool

const storageReads: string[] = []
const storage: StorageService = {
  readText: async (key) => {
    storageReads.push(key)
    throw new Error('Unauthorised routes must not read storage.')
  },
  writeText: async () => {
    throw new Error('Unauthorised routes must not write storage.')
  },
  readBinary: async (key) => {
    storageReads.push(key)
    throw new Error('Unauthorised routes must not read storage.')
  },
  writeBinary: async () => {
    throw new Error('Unauthorised routes must not write storage.')
  },
  delete: async () => undefined,
}

function app(role: 'member' | 'admin' = 'member') {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_matter_access')
    context.set('user', {
      id: 'usr_unshared',
      organisationId: 'org_1',
      role,
    })
    await next()
  })
  routes.route('/', createMattersRoutes(pool))
  routes.route('/', createDocumentAccessRoutes(pool))
  routes.route('/', createDocumentsRoutes(pool, storage))
  routes.route('/', createRedactRunCreationRoutes(pool, storage))
  routes.route('/', createRedactReviewRoutes(pool, storage))
  routes.route('/', createRedactLifecycleRoutes(pool, storage))
  return routes
}

const json = (body: unknown, method: 'POST' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function expectHidden(response: Response) {
  expect(response.status).toBe(404)
  expect(queries.some((sql) => sql.includes('matter_shares'))).toBe(true)
}

describe('mandatory matter-derived access boundary', () => {
  beforeEach(() => {
    queries.length = 0
    storageReads.length = 0
  })

  it('filters matter enumeration for an unshared organisation member', async () => {
    const response = await app().request('/api/matters')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ matters: [] })
    expect(queries.at(-1)).toContain('matter_shares')
  })

  const matterRoutes: Array<[string, string, RequestInit | undefined]> = [
    ['reads matter metadata', '/api/matters/mtr_private', undefined],
    [
      'changes matter metadata',
      '/api/matters/mtr_private',
      json({ clientReference: 'UNAUTHORISED' }, 'PATCH'),
    ],
    ['deletes a matter', '/api/matters/mtr_private', { method: 'DELETE' }],
    [
      'restores a matter',
      '/api/matters/mtr_private/restore',
      { method: 'PATCH' },
    ],
    ['lists matter shares', '/api/matters/mtr_private/shares', undefined],
    [
      'grants a matter share',
      '/api/matters/mtr_private/shares',
      json({ granteeUserId: 'usr_other', accessLevel: 'view' }),
    ],
    [
      'revokes a matter share',
      '/api/matters/mtr_private/shares/shr_1',
      { method: 'DELETE' },
    ],
  ]

  it.each(matterRoutes)(
    'hides a private matter when a member %s',
    async (_, path, init) => {
      const role =
        path.endsWith('/restore') || init?.method === 'DELETE'
          ? 'admin'
          : 'member'
      await expectHidden(await app(role).request(path, init))
    },
  )

  const documentRoutes: Array<
    [string, string, RequestInit | undefined, 'member' | 'admin']
  > = [
    [
      'uploads into it',
      '/api/matters/mtr_private/documents',
      json({
        filename: 'synthetic.txt',
        fileType: 'text/plain',
        sizeBytes: 9,
        contentSha256: 'a'.repeat(64),
      }),
      'member',
    ],
    [
      'lists its documents',
      '/api/matters/mtr_private/documents',
      undefined,
      'member',
    ],
    ['reads its document', '/api/documents/doc_private', undefined, 'member'],
    [
      'deletes its document',
      '/api/documents/doc_private',
      { method: 'DELETE' },
      'admin',
    ],
    [
      'restores its document',
      '/api/documents/doc_private/restore',
      { method: 'PATCH' },
      'admin',
    ],
  ]

  it.each(documentRoutes)(
    'hides a private document when a member %s',
    async (_, path, init, role) => {
      await expectHidden(await app(role).request(path, init))
    },
  )

  it('does not create a redaction run from an unshared document', async () => {
    await expectHidden(
      await app().request(
        '/api/documents/doc_private/redaction-runs',
        json({ policyMode: 'internal_ai_minimisation' }),
      ),
    )
    expect(storageReads).toEqual([])
  })

  const redactionReadRoutes = [
    '/api/redaction-runs/red_private',
    '/api/redaction-runs/red_private/document-text',
    '/api/redaction-runs/red_private/source-file',
    '/api/redaction-runs/red_private/layout',
    '/api/redaction-runs/red_private/output',
    '/api/redaction-runs/red_private/output/file',
    '/api/redaction-runs/red_private/token-map',
    '/api/redaction-runs/red_private/audit',
  ]

  it.each(redactionReadRoutes)(
    'hides matter-derived redaction data at %s',
    async (path) => {
      await expectHidden(await app().request(path))
      expect(storageReads).toEqual([])
    },
  )

  const redactionWriteRoutes: Array<[string, RequestInit, 'member' | 'admin']> =
    [
      [
        '/api/redaction-runs/red_private/spans/span_1/decision',
        json({ decision: 'accept' }),
        'member',
      ],
      [
        '/api/redaction-runs/red_private/finalize',
        json({ outputMode: 'redacted' }),
        'member',
      ],
      [
        '/api/redaction-runs/red_private/redetect',
        { method: 'POST' },
        'member',
      ],
      ['/api/redaction-runs/red_private', { method: 'DELETE' }, 'admin'],
      ['/api/redaction-runs/red_private/restore', { method: 'PATCH' }, 'admin'],
    ]

  it.each(redactionWriteRoutes)(
    'denies matter-derived redaction mutation at %s',
    async (path, init, role) => {
      await expectHidden(await app(role).request(path, init))
      expect(storageReads).toEqual([])
    },
  )

  it.each(['/api/redaction-runs', '/api/documents/doc_private/redaction-runs'])(
    'filters matter-derived runs from %s',
    async (path) => {
      const response = await app().request(path)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ runs: [] })
      expect(queries.at(-1)).toContain('matter_shares')
    },
  )
})
