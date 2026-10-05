import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { UserRole } from '@obiter/contracts'
import { createTestApiEnv } from '../test-api-env'
import { createTestPool } from '../test-database.test-support'
import type { AuthzUser, AuthzVariables } from '../authz'
import {
  auditCount,
  cleanupMatter,
  jsonRequest,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'
import {
  isMatterLockStatement,
  transactionObserveGate,
  transactionPauseGate,
  waitForLockWait,
} from './matter-lock-race.test-support'
import { createOrganisationsRoutes } from './organisations'
import {
  fullApp,
  sessionUser,
  uploadRequest,
} from './p0-13-residual-write-authorization.test-support'

/**
 * P0.13 residual paths: matter PATCH, matter soft-delete and restore, document
 * upload, document soft-delete and restore, and actor-side share grant/revoke.
 *
 * Each write below still had its edit predicate inside the locking statement,
 * or authorised share management on `matters.created_by` with no membership
 * re-read. A share revocation, edit-to-view downgrade, or member removal that
 * commits while the write is queued must make the write fail with the concealed
 * not-found response and leave no row, pointer, audit event or stored object.
 *
 * The lock, not a sleep, orders each transaction: the blocker holds the row
 * lock, the writer's own in-transaction statement is proven blocked in
 * `pg_stat_activity`, and only then does the blocker commit.
 */

type Seed = Awaited<ReturnType<typeof seedMatter>>
/** The revoke spec acts on a bystander share that member removal does not
 * delete, so a stale committed revoke is observable rather than a no-op. */
interface PreparedSeed extends Seed {
  bystanderShareId: string
}

interface PathSpec {
  name: string
  actorRole: UserRole
  // Some paths act on a soft-deleted matter or document.
  needsDeletedMatter?: boolean
  needsDeletedDocument?: boolean
  path: (seed: PreparedSeed) => string
  init: (seed: PreparedSeed) => RequestInit
  successStatus: number
  expectStorageWrite: boolean
  // After a successful soft-delete the share route can no longer see the
  // matter, so the follow-up revocation is itself the concealed 404.
  revokeAfterWriteStatus?: number
  deniedCode: 'matter_not_found' | 'document_not_found'
  assertDenied: (pool: Pool, seed: PreparedSeed) => Promise<void>
  assertApplied: (pool: Pool, seed: PreparedSeed) => Promise<void>
}

const pool = createTestPool()

function requirePid(pid: number | undefined, label: string) {
  if (pid === undefined)
    throw new Error(`${label} backend pid was not captured`)
  return pid
}

/** The writer's own in-transaction matter statement. On the fixed head it is
 * the predicate-free lock; on the unfixed base the matter PATCH has no
 * `FOR UPDATE`, so its mutating `update matters` is the locking statement. */
function isMatterWriteStatement(sql: string) {
  return isMatterLockStatement(sql) || sql.trim().startsWith('update matters')
}

const editShareSpecs: PathSpec[] = [
  {
    name: 'matter PATCH',
    actorRole: 'admin',
    path: (seed) => `/api/matters/${seed.matterId}`,
    init: () => jsonRequest('PATCH', { clientReference: 'P0.13-forbidden' }),
    successStatus: 200,
    expectStorageWrite: false,
    deniedCode: 'matter_not_found',
    assertDenied: async (current, seed) => {
      const row = await current.query<{ client_reference: string }>(
        `select client_reference from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.client_reference).toBe('')
      expect(await auditCount(current, seed, ['matter.update'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const row = await current.query<{ client_reference: string }>(
        `select client_reference from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.client_reference).toBe('P0.13-forbidden')
      expect(await auditCount(current, seed, ['matter.update'])).toBe(1)
    },
  },
  {
    name: 'matter soft-delete',
    actorRole: 'admin',
    path: (seed) => `/api/matters/${seed.matterId}`,
    init: () => ({ method: 'DELETE' }),
    successStatus: 200,
    expectStorageWrite: false,
    revokeAfterWriteStatus: 404,
    deniedCode: 'matter_not_found',
    assertDenied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.deleted_at).toBeNull()
      expect(await auditCount(current, seed, ['matter.delete'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.deleted_at).not.toBeNull()
      expect(await auditCount(current, seed, ['matter.delete'])).toBe(1)
    },
  },
  {
    name: 'matter restore',
    actorRole: 'admin',
    needsDeletedMatter: true,
    path: (seed) => `/api/matters/${seed.matterId}/restore`,
    init: () => ({ method: 'PATCH' }),
    successStatus: 200,
    expectStorageWrite: false,
    deniedCode: 'matter_not_found',
    assertDenied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.deleted_at).not.toBeNull()
      expect(await auditCount(current, seed, ['matter.restore'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.deleted_at).toBeNull()
      expect(await auditCount(current, seed, ['matter.restore'])).toBe(1)
    },
  },
  {
    name: 'document upload',
    actorRole: 'member',
    path: (seed) => `/api/matters/${seed.matterId}/documents`,
    init: () => uploadRequest(),
    successStatus: 201,
    expectStorageWrite: true,
    deniedCode: 'matter_not_found',
    assertDenied: async (current, seed) => {
      const docs = await current.query<{ n: number }>(
        `select count(*)::int as n from matter_documents where matter_id = $1`,
        [seed.matterId],
      )
      expect(docs.rows[0]?.n).toBe(1)
      expect(await auditCount(current, seed, ['document.upload'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const docs = await current.query<{ n: number }>(
        `select count(*)::int as n from matter_documents where matter_id = $1`,
        [seed.matterId],
      )
      expect(docs.rows[0]?.n).toBe(2)
      expect(await auditCount(current, seed, ['document.upload'])).toBe(1)
    },
  },
  {
    name: 'document soft-delete',
    actorRole: 'admin',
    path: (seed) => `/api/documents/${seed.documentId}`,
    init: () => ({ method: 'DELETE' }),
    successStatus: 200,
    expectStorageWrite: false,
    deniedCode: 'document_not_found',
    assertDenied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matter_documents where id = $1`,
        [seed.documentId],
      )
      expect(row.rows[0]?.deleted_at).toBeNull()
      expect(await auditCount(current, seed, ['document.delete'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matter_documents where id = $1`,
        [seed.documentId],
      )
      expect(row.rows[0]?.deleted_at).not.toBeNull()
      expect(await auditCount(current, seed, ['document.delete'])).toBe(1)
    },
  },
  {
    name: 'document restore',
    actorRole: 'admin',
    needsDeletedDocument: true,
    path: (seed) => `/api/documents/${seed.documentId}/restore`,
    init: () => ({ method: 'PATCH' }),
    successStatus: 200,
    expectStorageWrite: false,
    deniedCode: 'document_not_found',
    assertDenied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matter_documents where id = $1`,
        [seed.documentId],
      )
      expect(row.rows[0]?.deleted_at).not.toBeNull()
      expect(await auditCount(current, seed, ['document.restore'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const row = await current.query<{ deleted_at: string | null }>(
        `select deleted_at from matter_documents where id = $1`,
        [seed.documentId],
      )
      expect(row.rows[0]?.deleted_at).toBeNull()
      expect(await auditCount(current, seed, ['document.restore'])).toBe(1)
    },
  },
]

const actorShareSpecs: PathSpec[] = [
  {
    name: 'share grant',
    actorRole: 'member',
    path: (seed) => `/api/matters/${seed.matterId}/shares`,
    init: (seed) =>
      jsonRequest('POST', {
        granteeUserId: seed.ownerId,
        accessLevel: 'view',
      }),
    successStatus: 201,
    expectStorageWrite: false,
    deniedCode: 'matter_not_found',
    assertDenied: async (current, seed) => {
      const shares = await current.query<{ n: number }>(
        `select count(*)::int as n from matter_shares
         where matter_id = $1 and grantee_user_id = $2`,
        [seed.matterId, seed.ownerId],
      )
      expect(shares.rows[0]?.n).toBe(0)
      expect(await auditCount(current, seed, ['matter.share_grant'])).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const shares = await current.query<{ n: number }>(
        `select count(*)::int as n from matter_shares
         where matter_id = $1 and grantee_user_id = $2`,
        [seed.matterId, seed.ownerId],
      )
      expect(shares.rows[0]?.n).toBe(1)
      expect(await auditCount(current, seed, ['matter.share_grant'])).toBe(1)
    },
  },
  {
    name: 'share revoke',
    actorRole: 'member',
    path: (seed) =>
      `/api/matters/${seed.matterId}/shares/${seed.bystanderShareId}`,
    init: () => ({ method: 'DELETE' }),
    successStatus: 200,
    expectStorageWrite: false,
    deniedCode: 'matter_not_found',
    assertDenied: async (current, seed) => {
      // The bystander share is not the removed editor's, so its presence is
      // direct evidence the writer's revoke did not commit. The writer's own
      // request id isolates its audit from removal's.
      const share = await current.query<{ id: string }>(
        `select id from matter_shares where id = $1`,
        [seed.bystanderShareId],
      )
      expect(share.rows.length).toBe(1)
      const result = await current.query<{ n: number }>(
        `select count(*)::int as n from audit_logs
         where organisation_id = $1 and action = 'matter.share_revoke'
           and request_id = 'req_writer'`,
        [seed.orgId],
      )
      expect(result.rows[0]?.n).toBe(0)
    },
    assertApplied: async (current, seed) => {
      const share = await current.query<{ id: string }>(
        `select id from matter_shares where id = $1`,
        [seed.bystanderShareId],
      )
      expect(share.rows.length).toBe(0)
      expect(await auditCount(current, seed, ['matter.share_revoke'])).toBe(1)
    },
  },
]

async function prepareSpec(spec: PathSpec): Promise<PreparedSeed> {
  const seed = await seedMatter(pool, 'edit')
  if (spec.name.startsWith('share ')) {
    await pool.query(`update matters set created_by = $2 where id = $1`, [
      seed.matterId,
      seed.editorId,
    ])
  }
  if (spec.needsDeletedMatter) {
    await pool.query(
      `update matters set status = 'deleted', deleted_at = now() where id = $1`,
      [seed.matterId],
    )
  }
  if (spec.needsDeletedDocument) {
    await pool.query(
      `update matter_documents set deleted_at = now() where id = $1`,
      [seed.documentId],
    )
  }
  let bystanderShareId = seed.shareId
  if (spec.name === 'share revoke') {
    bystanderShareId = `shr_bystander_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    await pool.query(
      `insert into matter_shares (
         id, organisation_id, matter_id, grantee_user_id, access_level,
         created_by, created_at
       ) values ($1, $2, $3, $4, 'view', $5, now())`,
      [
        bystanderShareId,
        seed.orgId,
        seed.matterId,
        seed.ownerId,
        seed.editorId,
      ],
    )
  }
  return { ...seed, bystanderShareId }
}

function actorUser(spec: PathSpec, seed: PreparedSeed): AuthzUser {
  return sessionUser(seed, 'editor', spec.actorRole)
}

function removalApp(user: AuthzUser, requestId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', requestId)
    c.set('user', user)
    await next()
  })
  routes.route('/', createOrganisationsRoutes(pool, createTestApiEnv()))
  return routes
}

async function expectDenied(
  response: Response,
  code: 'matter_not_found' | 'document_not_found',
) {
  expect(response.status).toBe(404)
  await expect(response.json()).resolves.toMatchObject({ error: { code } })
}

async function openShareRevocation(
  seed: Seed,
  conflict: 'revoke' | 'downgrade',
) {
  const revoker = transactionPauseGate(pool, isMatterLockStatement)
  const owner = fullApp(
    revoker.pool,
    storageFor(seed),
    ownerUser(seed),
    'req_revoker',
  )
  const request =
    conflict === 'revoke'
      ? owner.request(`/api/matters/${seed.matterId}/shares/${seed.shareId}`, {
          method: 'DELETE',
        })
      : owner.request(
          `/api/matters/${seed.matterId}/shares`,
          jsonRequest('POST', {
            granteeUserId: seed.editorId,
            accessLevel: 'view',
          }),
        )
  await revoker.entered
  return { revoker, request }
}

/** Blocker holds the matter lock; the writer's own locking statement must be
 * proven blocked before the blocker commits. */
async function runWriterBlocked(
  spec: PathSpec,
  conflict: 'revoke' | 'downgrade',
) {
  const seed = await prepareSpec(spec)
  const storage = storageFor(seed)
  let revoker: ReturnType<typeof transactionPauseGate> | undefined
  try {
    const opened = await openShareRevocation(seed, conflict)
    revoker = opened.revoker
    const { request } = opened
    const writerGate = transactionObserveGate(pool, isMatterWriteStatement)
    const writer = fullApp(
      writerGate.pool,
      storage,
      actorUser(spec, seed),
      'req_writer',
    )

    const writing = writer.request(spec.path(seed), spec.init(seed))
    await writerGate.entered

    const blockers = await waitForLockWait(
      pool,
      requirePid(writerGate.backendPid, 'writer'),
    )
    expect(blockers).toContain(requirePid(revoker.backendPid, 'revoker'))

    revoker.open()
    const revoked = await request
    expect(revoked.status).toBe(conflict === 'revoke' ? 200 : 201)

    await expectDenied(await writing, spec.deniedCode)
    await spec.assertDenied(pool, seed)
    if (spec.expectStorageWrite) expect(storage.writes).toEqual([])
  } finally {
    // Release either gate before cleanup so an assertion failure cannot leave a
    // transaction holding the row lock and cascade into neighbour timeouts.
    revoker?.open()
    await cleanupMatter(pool, seed)
  }
}

/** Member removal takes no matter lock. The writer is paused after its matter
 * lock; removal commits; the writer resumes and must observe the lost share or
 * membership. */
async function runWriterBlockedByRemoval(spec: PathSpec) {
  const seed = await prepareSpec(spec)
  const storage = storageFor(seed)
  const writerGate = transactionPauseGate(pool, isMatterWriteStatement)
  try {
    const writer = fullApp(
      writerGate.pool,
      storage,
      actorUser(spec, seed),
      'req_writer',
    )
    const removal = removalApp(ownerUser(seed), 'req_removal')

    const writing = writer.request(spec.path(seed), spec.init(seed))
    await writerGate.entered

    const removed = await removal.request(
      `/api/organisations/${seed.orgId}/members/${seed.editorId}`,
      { method: 'DELETE' },
    )
    expect(removed.status).toBe(200)

    writerGate.open()
    await expectDenied(await writing, spec.deniedCode)
    await spec.assertDenied(pool, seed)
    if (spec.expectStorageWrite) expect(storage.writes).toEqual([])
  } finally {
    writerGate.open()
    await cleanupMatter(pool, seed)
  }
}

/** Writer wins the lock, so its authorised commit precedes the revocation. */
async function runWriterWins(spec: PathSpec) {
  const seed = await prepareSpec(spec)
  const storage = storageFor(seed)
  const writerGate = transactionPauseGate(pool, isMatterWriteStatement)
  try {
    const writer = fullApp(
      writerGate.pool,
      storage,
      actorUser(spec, seed),
      'req_writer',
    )
    const revokerGate = transactionObserveGate(pool, isMatterLockStatement)
    const owner = fullApp(
      revokerGate.pool,
      storageFor(seed),
      ownerUser(seed),
      'req_revoker',
    )

    const writing = writer.request(spec.path(seed), spec.init(seed))
    await writerGate.entered

    const revoking = owner.request(
      `/api/matters/${seed.matterId}/shares/${seed.shareId}`,
      { method: 'DELETE' },
    )
    await revokerGate.entered

    const blockers = await waitForLockWait(
      pool,
      requirePid(revokerGate.backendPid, 'revoker'),
    )
    expect(blockers).toContain(requirePid(writerGate.backendPid, 'writer'))

    writerGate.open()
    const written = await writing
    expect(written.status).toBe(spec.successStatus)
    await spec.assertApplied(pool, seed)

    const revoked = await revoking
    expect(revoked.status).toBe(spec.revokeAfterWriteStatus ?? 200)
  } finally {
    writerGate.open()
    await cleanupMatter(pool, seed)
  }
}

/** Writer completes first; removal then succeeds without touching it. */
async function runWriterThenRemoval(spec: PathSpec) {
  const seed = await prepareSpec(spec)
  try {
    const storage = storageFor(seed)
    const writer = fullApp(pool, storage, actorUser(spec, seed), 'req_writer')
    const removal = removalApp(ownerUser(seed), 'req_removal')

    const written = await writer.request(spec.path(seed), spec.init(seed))
    expect(written.status).toBe(spec.successStatus)
    await spec.assertApplied(pool, seed)

    const removed = await removal.request(
      `/api/organisations/${seed.orgId}/members/${seed.editorId}`,
      { method: 'DELETE' },
    )
    expect(removed.status).toBe(200)
    const membership = await pool.query<{ organisationId: string | null }>(
      `select "organisationId" from users where id = $1`,
      [seed.editorId],
    )
    expect(membership.rows[0]?.organisationId).toBeNull()
  } finally {
    await cleanupMatter(pool, seed)
  }
}

const activeMatterEditSpecs = editShareSpecs.filter(
  (spec) => !spec.needsDeletedMatter,
)

for (const spec of activeMatterEditSpecs) {
  describe(`${spec.name} on an active matter`, () => {
    it('denies a write blocked behind a committed share revocation', async () => {
      await runWriterBlocked(spec, 'revoke')
    }, 30_000)

    it('denies a write blocked behind an edit-to-view downgrade', async () => {
      await runWriterBlocked(spec, 'downgrade')
    }, 30_000)

    it('denies a write whose matter lock preceded a member removal', async () => {
      await runWriterBlockedByRemoval(spec)
    }, 30_000)

    it('lets the lock-winning write commit before revocation', async () => {
      await runWriterWins(spec)
    }, 30_000)

    it('lets an authorised write finish before member removal', async () => {
      await runWriterThenRemoval(spec)
    }, 30_000)
  })
}

describe('matter restore on a soft-deleted matter', () => {
  it('denies a restore whose matter lock preceded a member removal', async () => {
    await runWriterBlockedByRemoval(editShareSpecs[2])
  }, 30_000)

  it('restores before the creator is removed', async () => {
    await runWriterThenRemoval(editShareSpecs[2])
  }, 30_000)
})

for (const spec of actorShareSpecs) {
  describe(`${spec.name} by the removable creator`, () => {
    it('denies an in-flight grant or revoke after a member removal commits', async () => {
      await runWriterBlockedByRemoval(spec)
    }, 30_000)

    it('lets the creator share-management request commit before removal', async () => {
      await runWriterThenRemoval(spec)
    }, 30_000)
  })
}

describe('residual-path positive and negative controls', () => {
  it('lets the matter owner update without a share', async () => {
    const seed = await seedMatter(pool, null)
    try {
      const writer = fullApp(pool, storageFor(seed), ownerUser(seed), 'req')
      const response = await writer.request(`/api/matters/${seed.matterId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientReference: 'owner-write' }),
      })
      expect(response.status).toBe(200)
      const row = await pool.query<{ client_reference: string }>(
        `select client_reference from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.client_reference).toBe('owner-write')
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('hides a view-only share from the matter PATCH', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const writer = fullApp(
        pool,
        storageFor(seed),
        sessionUser(seed, 'editor', 'admin'),
        'req',
      )
      const response = await writer.request(`/api/matters/${seed.matterId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientReference: 'view-write' }),
      })
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'matter_not_found' },
      })
      const row = await pool.query<{ client_reference: string }>(
        `select client_reference from matters where id = $1`,
        [seed.matterId],
      )
      expect(row.rows[0]?.client_reference).toBe('')
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('hides a cross-organisation matter PATCH and leaves no audit row', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const stranger = fullApp(
        pool,
        storageFor(seed),
        { id: seed.strangerId, organisationId: seed.otherOrgId, role: 'owner' },
        'req',
      )
      const response = await stranger.request(`/api/matters/${seed.matterId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientReference: 'cross-org' }),
      })
      expect(response.status).toBe(404)
      expect(await auditCount(pool, seed, ['matter.update'])).toBe(0)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('returns 404 on a second restore without reviving a second time', async () => {
    const seed = await prepareSpec(editShareSpecs[2])
    try {
      const writer = fullApp(
        pool,
        storageFor(seed),
        sessionUser(seed, 'editor', 'admin'),
        'req',
      )
      const first = await writer.request(
        `/api/matters/${seed.matterId}/restore`,
        { method: 'PATCH' },
      )
      expect(first.status).toBe(200)
      const second = await writer.request(
        `/api/matters/${seed.matterId}/restore`,
        { method: 'PATCH' },
      )
      expect(second.status).toBe(404)
      expect(await auditCount(pool, seed, ['matter.restore'])).toBe(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('returns 404 on a second document delete without a second audit row', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const writer = fullApp(
        pool,
        storageFor(seed),
        sessionUser(seed, 'editor', 'admin'),
        'req',
      )
      const first = await writer.request(`/api/documents/${seed.documentId}`, {
        method: 'DELETE',
      })
      expect(first.status).toBe(200)
      const second = await writer.request(`/api/documents/${seed.documentId}`, {
        method: 'DELETE',
      })
      expect(second.status).toBe(404)
      expect(await auditCount(pool, seed, ['document.delete'])).toBe(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
