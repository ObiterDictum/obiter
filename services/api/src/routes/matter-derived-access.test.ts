import { Hono } from 'hono'
import type { Pool } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthzVariables } from '../authz'
import type { StorageService } from '../storage'
import type { RedactionRunRow } from '../redaction-database'
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

const standaloneRun: RedactionRunRow = {
  id: 'red_standalone',
  organisation_id: 'org_1',
  matter_id: null,
  matter_name: null,
  document_id: null,
  document_version_id: null,
  source_filename: 'standalone.txt',
  source_text_object_key: 'org/org_1/redaction-runs/red_standalone/source',
  source_file_object_key: null,
  source_layout_object_key: null,
  source_mime_type: 'text/plain',
  status: 'ready_for_review',
  policy_mode: 'internal_ai_minimisation',
  spans_json: [],
  decisions_json: {},
  output_artifact_id: null,
  summary_json: {},
  detector_version: 'detector-1',
  detection_mode: 'model+supplement',
  replaces_run_id: null,
  replacement_run_id: null,
  created_by: 'usr_creator',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  deleted_by: null,
}

function standalonePool(
  run = standaloneRun,
  options: {
    userId?: string
    matterOwnerId?: string
    sharedUserId?: string
  } = {},
) {
  const userId = options.userId ?? 'usr_unshared'
  const query = async (sql: string, parameters: unknown[] = []) => {
    queries.push(sql)
    if (!sql.toLowerCase().includes('from redaction_runs')) return { rows: [] }
    const checksAccess = parameters.includes(userId)
    if (checksAccess) {
      const allowed = run.matter_id
        ? userId === (options.matterOwnerId ?? run.created_by) ||
          userId === options.sharedUserId
        : userId === run.created_by
      if (!allowed) return { rows: [] }
    }
    if (sql.includes('deleted_at is not null')) {
      if (sql.trim().startsWith('select id from redaction_runs'))
        return run.deleted_at ? { rows: [{ id: run.id }] } : { rows: [] }
      return run.deleted_at ? { rows: [run] } : { rows: [] }
    }
    if (sql.includes('select run.matter_id, run.document_id')) {
      return {
        rows: [
          {
            matter_id: run.matter_id,
            document_id: run.document_id,
            replaces_run_id: run.replaces_run_id,
          },
        ],
      }
    }
    if (sql.includes('select deleted_at::text'))
      return { rows: [{ deleted_at: '2026-02-01T00:00:00.000Z' }] }
    return { rows: [run] }
  }
  return {
    query,
    connect: async () => ({ query, release: () => undefined }),
  } as unknown as Pool
}

function standaloneApp(
  role: 'member' | 'admin' = 'member',
  run = standaloneRun,
  userId = 'usr_unshared',
  access: { matterOwnerId?: string; sharedUserId?: string } = {},
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_standalone_access')
    context.set('user', {
      id: userId,
      organisationId: 'org_1',
      role,
    })
    await next()
  })
  const pool = standalonePool(run, { userId, ...access })
  routes.route('/', createRedactRunCreationRoutes(pool, storage))
  routes.route('/', createRedactReviewRoutes(pool, storage))
  routes.route('/', createRedactLifecycleRoutes(pool, storage))
  return routes
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

  it('rejects invalid standalone creation before writing storage', async () => {
    const response = await app().request(
      '/api/redaction-runs',
      json({ filename: '', text: '' }),
    )
    expect(response.status).toBe(400)
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

  const standaloneRunRoutes: Array<
    [string, RequestInit | undefined, 'member' | 'admin']
  > = [
    ['/api/redaction-runs/red_standalone', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/document-text', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/source-file', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/layout', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/output', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/output/file', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/token-map', undefined, 'member'],
    ['/api/redaction-runs/red_standalone/audit', undefined, 'member'],
    [
      '/api/redaction-runs/red_standalone/spans/span_1/decision',
      json({ decision: 'accept' }),
      'member',
    ],
    [
      '/api/redaction-runs/red_standalone/finalize',
      json({ outputMode: 'redacted' }),
      'member',
    ],
    [
      '/api/redaction-runs/red_standalone/redetect',
      { method: 'POST' },
      'member',
    ],
    ['/api/redaction-runs/red_standalone', { method: 'DELETE' }, 'admin'],
    [
      '/api/redaction-runs/red_standalone/restore',
      { method: 'PATCH' },
      'admin',
    ],
  ]

  it.each(standaloneRunRoutes)(
    'denies a non-creator on %s without reading storage',
    async (path, init, role) => {
      await expectHidden(await standaloneApp(role).request(path, init))
      expect(storageReads).toEqual([])
    },
  )

  it('allows the standalone run creator to read the run', async () => {
    const response = await standaloneApp(
      'member',
      standaloneRun,
      'usr_creator',
    ).request('/api/redaction-runs/red_standalone')
    expect(response.status).toBe(200)
    expect(storageReads).toEqual([])
  })

  it('allows a matter share grantee to read a linked run', async () => {
    const response = await standaloneApp(
      'member',
      { ...standaloneRun, matter_id: 'mtr_1' },
      'usr_grantee',
      { matterOwnerId: 'usr_owner', sharedUserId: 'usr_grantee' },
    ).request('/api/redaction-runs/red_standalone')
    expect(response.status).toBe(200)
    expect(storageReads).toEqual([])
  })

  it('filters a non-creator from the generic standalone run list', async () => {
    const response = await standaloneApp().request('/api/redaction-runs')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ runs: [] })
    expect(storageReads).toEqual([])
  })

  it('gives an admin access to a deleted standalone audit', async () => {
    const response = await standaloneApp('admin', {
      ...standaloneRun,
      status: 'finalized',
      deleted_at: '2026-02-01T00:00:00.000Z',
    }).request('/api/redaction-runs/red_standalone/audit')
    expect(response.status).toBe(200)
    expect(storageReads).toEqual([])
  })
})
