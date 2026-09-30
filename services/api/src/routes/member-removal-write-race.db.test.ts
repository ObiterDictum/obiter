import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { Pool, PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'bun:test'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createTestApiEnv } from '../test-api-env'
import { createTestPool } from '../test-database.test-support'
import { createOrganisationsRoutes } from './organisations'
import {
  app,
  auditCount,
  cleanupMatter,
  editorUser,
  expectConcealed,
  jsonRequest,
  ownerUser,
  seedMatter,
  shareApp,
  specs,
  state,
  storageFor,
} from './document-write-share-revocation.test-support'

/**
 * P0.13 member-removal half: a write that passed its route-level check must
 * not commit after POST member removal revoked the member's access.
 *
 * Member removal locks the departing user row `FOR UPDATE` and deletes that
 * user's shares; `lockMatterForEdit` takes a `FOR SHARE` on the acting user
 * row after the matter lock. The writer is paused by a transaction gate after
 * its matter lock, removal commits, and the writer resumes. On the unfixed
 * head the writer has no membership re-read and commits; on the fix it
 * observes the removed membership and fails.
 */

type Seed = Awaited<ReturnType<typeof seedMatter>>

const pool = createTestPool()

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Holds the first transaction query that `matches` until `open()` is called.
 * The query has already run, so its locks and snapshot are fixed; the caller
 * controls exactly which transaction resumes next without relying on timing.
 */
function transactionGate(pool: Pool, matches: (sql: string) => boolean) {
  let markEntered: () => void = () => undefined
  let openGate: () => void = () => undefined
  let armed = true
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const opened = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const query = pool.query.bind(pool) as Pool['query']
  return {
    entered,
    open: () => openGate(),
    pool: {
      query: (sql: string, parameters?: unknown[]) => query(sql, parameters),
      connect: async () => {
        const client: PoolClient = await pool.connect()
        return {
          query: async (sql: string, parameters: unknown[] = []) => {
            const result = await client.query(sql, parameters)
            if (armed && matches(sql)) {
              armed = false
              markEntered()
              await opened
            }
            return result
          },
          release: () => client.release(),
        }
      },
    } as unknown as Pool,
  }
}

const matterLockGate = (pool: Pool) =>
  transactionGate(
    pool,
    (sql) => sql.includes('from matters matter') && sql.includes('for update'),
  )
const membershipGate = (pool: Pool) =>
  transactionGate(
    pool,
    (sql) => sql.includes('select role') && sql.includes('for update'),
  )

function removalApp(pool: Pool, user: AuthzUser, requestId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', requestId)
    c.set('user', user)
    await next()
  })
  routes.route('/', createOrganisationsRoutes(pool, createTestApiEnv()))
  return routes
}

function removeMemberPath(seed: Seed, userId: string) {
  return `/api/organisations/${seed.orgId}/members/${userId}`
}

function grantRequest(seed: Seed, matterId: string, granteeUserId: string) {
  return {
    method: 'POST',
    path: `/api/matters/${matterId}/shares`,
    body: { granteeUserId, accessLevel: 'edit' },
  }
}

async function memberOrganisationId(pool: Pool, userId: string) {
  const result = await pool.query<{ organisationId: string | null }>(
    `select "organisationId" from users where id = $1`,
    [userId],
  )
  return result.rows[0]?.organisationId ?? null
}

async function cleanupRemoval(pool: Pool, seed: Seed) {
  await cleanupMatter(pool, seed)
  await pool.query(`delete from users where id = any($1::text[])`, [
    [seed.ownerId, seed.editorId, seed.strangerId],
  ])
}

for (const spec of specs) {
  describe(`member removal vs ${spec.name}`, () => {
    it('denies a write whose matter lock preceded a removal commit', async () => {
      const seed = await seedMatter(pool, 'edit')
      try {
        const storage = storageFor(seed)
        const writerGate = matterLockGate(pool)
        const writer = app(
          writerGate.pool,
          storage,
          editorUser(seed),
          'req_writer',
        )
        const removal = removalApp(pool, ownerUser(seed), 'req_removal')

        const writing = writer.request(
          spec.path(seed),
          jsonRequest(spec.method, spec.payload(seed)),
        )
        await writerGate.entered

        const removed = await removal.request(
          removeMemberPath(seed, seed.editorId),
          { method: 'DELETE' },
        )
        expect(removed.status).toBe(200)

        writerGate.open()
        await expectConcealed(await writing)

        const after = await state(pool, seed)
        expect(after.versions).toBe(1)
        expect(after.currentVersionId).toBe(seed.versionId)
        expect(after.unresolvedComments).toBe(1)
        expect(after.shares).toBe(0)
        expect(await auditCount(pool, seed, spec.actions)).toBe(0)
        expect(storage.writes).toEqual([])
        expect(await memberOrganisationId(pool, seed.editorId)).toBeNull()
      } finally {
        await cleanupRemoval(pool, seed)
      }
    })
  })
}

describe('member removal vs a removable matter creator', () => {
  async function creatorSeed() {
    const seed = await seedMatter(pool, 'edit')
    // The member with the share becomes the second owner so the creator can be
    // removed, while the creator reaches the matter through `created_by`, the
    // branch share deletion cannot change.
    await pool.query(`update users set role = 'owner' where id = $1`, [
      seed.editorId,
    ])
    return seed
  }

  function creatorWriter(seed: Seed, gatePool: Pool) {
    return app(gatePool, storageFor(seed), ownerUser(seed), 'req_writer')
  }

  it('denies an in-flight creator write when the creator is removed first', async () => {
    const seed = await creatorSeed()
    try {
      const writerGate = matterLockGate(pool)
      const writer = creatorWriter(seed, writerGate.pool)
      const removal = removalApp(
        pool,
        { id: seed.editorId, organisationId: seed.orgId, role: 'owner' },
        'req_removal',
      )

      const writing = writer.request(
        specs[0].path(seed),
        jsonRequest(specs[0].method, specs[0].payload(seed)),
      )
      await writerGate.entered

      const removed = await removal.request(
        removeMemberPath(seed, seed.ownerId),
        { method: 'DELETE' },
      )
      expect(removed.status).toBe(200)

      writerGate.open()
      await expectConcealed(await writing)

      expect((await state(pool, seed)).versions).toBe(1)
      expect(await memberOrganisationId(pool, seed.ownerId)).toBeNull()
    } finally {
      await cleanupRemoval(pool, seed)
    }
  })

  it('lets a creator write that commits first stand, then removes', async () => {
    const seed = await creatorSeed()
    try {
      const writer = creatorWriter(seed, pool)
      const removal = removalApp(
        pool,
        { id: seed.editorId, organisationId: seed.orgId, role: 'owner' },
        'req_removal',
      )

      const response = await writer.request(
        specs[0].path(seed),
        jsonRequest(specs[0].method, specs[0].payload(seed)),
      )
      expect(response.status).toBe(201)

      const removed = await removal.request(
        removeMemberPath(seed, seed.ownerId),
        { method: 'DELETE' },
      )
      expect(removed.status).toBe(200)

      const after = await state(pool, seed)
      expect(after.versions).toBe(2)
      expect(after.currentVersionId).not.toBe(seed.versionId)
      expect(await memberOrganisationId(pool, seed.ownerId)).toBeNull()
    } finally {
      await cleanupRemoval(pool, seed)
    }
  })

  it('does not answer a removed creator with an already_applied merge replay', async () => {
    const seed = await creatorSeed()
    try {
      const writer = creatorWriter(seed, pool)
      const removal = removalApp(
        pool,
        { id: seed.editorId, organisationId: seed.orgId, role: 'owner' },
        'req_removal',
      )
      const spec = specs[1]
      const payload = spec.payload(seed)

      const first = await writer.request(
        spec.path(seed),
        jsonRequest(spec.method, payload),
      )
      expect(first.status).toBe(201)

      const removed = await removal.request(
        removeMemberPath(seed, seed.ownerId),
        { method: 'DELETE' },
      )
      expect(removed.status).toBe(200)

      const replay = await writer.request(
        spec.path(seed),
        jsonRequest(spec.method, payload),
      )
      await expectConcealed(replay)
      expect((await state(pool, seed)).versions).toBe(2)
    } finally {
      await cleanupRemoval(pool, seed)
    }
  })
})

describe('member removal vs share grants', () => {
  it('rejects a grant while removal holds the membership lock', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const gate = membershipGate(pool)
      const removal = removalApp(gate.pool, ownerUser(seed), 'req_removal')
      const removing = removal.request(removeMemberPath(seed, seed.editorId), {
        method: 'DELETE',
      })
      await gate.entered

      const request = grantRequest(seed, seed.matterId, seed.editorId)
      const granting = shareApp(pool, ownerUser(seed), 'req_grant').request(
        request.path,
        jsonRequest(request.method, request.body),
      )

      gate.open()
      const [removed, grant] = await withTimeout(
        Promise.all([removing, granting]),
        5000,
        'grant while removal holds the membership lock',
      )
      expect(removed.status).toBe(200)
      expect(grant.status).toBe(400)
      const shares = await pool.query<{ n: number }>(
        `select count(*)::int as n from matter_shares where grantee_user_id = $1`,
        [seed.editorId],
      )
      expect(shares.rows[0]?.n).toBe(0)
    } finally {
      await cleanupRemoval(pool, seed)
    }
  })

  it('serialises grants on two matters with removal without deadlock', async () => {
    const seed = await seedMatter(pool, 'edit')
    const secondMatterId = `mtr_removal_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    try {
      await pool.query(
        `insert into matters (
           id, organisation_id, name, description, primary_jurisdiction,
           secondary_jurisdictions, legal_domains, client_reference,
           status, created_by, created_at, updated_at
         ) values ($1, $2, $3, null, 'england_and_wales', '[]'::jsonb,
           '[]'::jsonb, '', 'active', $4, now(), now())`,
        [secondMatterId, seed.orgId, 'Second matter', seed.ownerId],
      )

      const gate = membershipGate(pool)
      const removal = removalApp(gate.pool, ownerUser(seed), 'req_removal')
      const removing = removal.request(removeMemberPath(seed, seed.editorId), {
        method: 'DELETE',
      })
      await gate.entered

      const first = grantRequest(seed, seed.matterId, seed.editorId)
      const second = grantRequest(seed, secondMatterId, seed.editorId)
      const grantingFirst = shareApp(
        pool,
        ownerUser(seed),
        'req_grant_1',
      ).request(first.path, jsonRequest(first.method, first.body))
      const grantingSecond = shareApp(
        pool,
        ownerUser(seed),
        'req_grant_2',
      ).request(second.path, jsonRequest(second.method, second.body))

      gate.open()
      const [removed, grantOne, grantTwo] = await withTimeout(
        Promise.all([removing, grantingFirst, grantingSecond]),
        5000,
        'grants on two matters with removal',
      )
      expect(removed.status).toBe(200)
      expect([grantOne.status, grantTwo.status]).toEqual([400, 400])
      const shares = await pool.query<{ n: number }>(
        `select count(*)::int as n from matter_shares where grantee_user_id = $1`,
        [seed.editorId],
      )
      expect(shares.rows[0]?.n).toBe(0)
    } finally {
      await cleanupRemoval(pool, seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
