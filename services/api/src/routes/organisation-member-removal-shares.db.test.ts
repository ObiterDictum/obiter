import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { Pool, type PoolClient } from 'pg'
import { createTestPool } from '../test-database.test-support'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AuthzVariables } from '../authz'
import { createTestApiEnv } from '../test-api-env'
import { createDocumentAccessRoutes } from './document-access'
import { createOrganisationsRoutes } from './organisations'

/**
 * Removing a member must revoke their matter shares in the same transaction.
 * The composite grantee key from 0027 rejects the organisationId change while
 * any share remains, so this exercises the transactional revocation the route
 * performs and the real lock interaction with a concurrent grant.
 */

const REQUEST_ID = 'req_member_removal_shares'

function app(pool: Pool, userId: string, organisationId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', REQUEST_ID)
    context.set('user', { id: userId, organisationId, role: 'owner' })
    await next()
  })
  routes.route('/', createDocumentAccessRoutes(pool))
  routes.route('/', createOrganisationsRoutes(pool, createTestApiEnv()))
  return routes
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface RemovalSeed {
  orgId: string
  ownerId: string
  memberId: string
  otherMemberId: string
  matterId: string
  shareId: string
  otherShareId: string
}

async function seed(pool: Pool): Promise<RemovalSeed> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const seed: RemovalSeed = {
    orgId: `org_rmv_${suffix}`,
    ownerId: `usr_rmv_${suffix}_owner`,
    memberId: `usr_rmv_${suffix}_member`,
    otherMemberId: `usr_rmv_${suffix}_other`,
    matterId: `mtr_rmv_${suffix}`,
    shareId: `shr_rmv_${suffix}_member`,
    otherShareId: `shr_rmv_${suffix}_other`,
  }
  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [seed.orgId, `Removal Org ${suffix}`],
  )
  for (const [userId, role] of [
    [seed.ownerId, 'owner'],
    [seed.memberId, 'member'],
    [seed.otherMemberId, 'member'],
  ] as const) {
    await pool.query(
      `insert into users (
         id, name, email, "emailVerified", "organisationId", role,
         "createdAt", "updatedAt"
       )
       values ($1, $2, $3, true, $4, $5, now(), now())`,
      [
        userId,
        `Removal User ${userId.slice(-3)}`,
        `${userId}@example.com`,
        seed.orgId,
        role,
      ],
    )
  }
  await pool.query(
    `insert into matters (
       id, organisation_id, name, description, primary_jurisdiction,
       secondary_jurisdictions, legal_domains, client_reference,
       status, created_by, created_at, updated_at
     )
     values ($1, $2, $3, null, 'england_and_wales', '[]'::jsonb, '[]'::jsonb, '',
       'active', $4, now(), now())`,
    [seed.matterId, seed.orgId, `Removal matter ${suffix}`, seed.ownerId],
  )
  for (const [shareId, granteeUserId] of [
    [seed.shareId, seed.memberId],
    [seed.otherShareId, seed.otherMemberId],
  ] as const) {
    await pool.query(
      `insert into matter_shares (
         id, organisation_id, matter_id, grantee_user_id, access_level,
         created_by, created_at
       )
       values ($1, $2, $3, $4, 'view', $5, now())`,
      [shareId, seed.orgId, seed.matterId, granteeUserId, seed.ownerId],
    )
  }
  return seed
}

async function cleanup(pool: Pool, seed: RemovalSeed) {
  await pool.query(`delete from audit_logs where request_id = $1`, [REQUEST_ID])
  await pool.query(`delete from matter_shares where id = any($1::text[])`, [
    [seed.shareId, seed.otherShareId],
  ])
  await pool.query(`delete from matters where id = $1`, [seed.matterId])
  await pool.query(`delete from users where id = any($1::text[])`, [
    [seed.ownerId, seed.memberId, seed.otherMemberId],
  ])
  await pool.query(`delete from organisations where id = $1`, [seed.orgId])
}

describe('organisation member removal revokes matter shares (db)', () => {
  const pool = createTestPool()
  const gatePool = createTestPool()
  let seedData: RemovalSeed

  beforeAll(async () => {
    seedData = await seed(pool)
  })

  afterAll(async () => {
    await cleanup(pool, seedData)
    await pool.end()
    await gatePool.end()
  })

  it('revokes the removed member shares and audits each revocation', async () => {
    const owner = app(pool, seedData.ownerId, seedData.orgId)
    const response = await owner.request(
      `/api/organisations/${seedData.orgId}/members/${seedData.memberId}`,
      { method: 'DELETE' },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      removed: true,
      userId: seedData.memberId,
    })

    const member = await pool.query<{ organisationId: string | null }>(
      `select "organisationId" from users where id = $1`,
      [seedData.memberId],
    )
    expect(member.rows[0]?.organisationId).toBeNull()

    const revoked = await pool.query<{ n: number }>(
      `select count(*)::int as n from matter_shares where id = $1`,
      [seedData.shareId],
    )
    expect(revoked.rows[0]?.n).toBe(0)

    const audit = await pool.query<{
      organisation_id: string
      user_id: string
      entity_type: string
      entity_id: string
      action: string
      matter_id: string
      grantee_user_id: string
    }>(
      `select organisation_id, user_id, entity_type, entity_id, action,
         metadata_json->>'matterId' as matter_id,
         metadata_json->>'granteeUserId' as grantee_user_id
       from audit_logs
       where request_id = $1 and action = 'matter.share_revoke'`,
      [REQUEST_ID],
    )
    expect(audit.rows).toEqual([
      {
        organisation_id: seedData.orgId,
        user_id: seedData.ownerId,
        entity_type: 'matter_share',
        entity_id: seedData.shareId,
        action: 'matter.share_revoke',
        matter_id: seedData.matterId,
        grantee_user_id: seedData.memberId,
      },
    ])
  })

  it('leaves other members shares intact', async () => {
    const retained = await pool.query<{ n: number }>(
      `select count(*)::int as n from matter_shares where id = $1`,
      [seedData.otherShareId],
    )
    expect(retained.rows[0]?.n).toBe(1)
  })

  it('rejects a grant to the removed member without inserting a share', async () => {
    const owner = app(pool, seedData.ownerId, seedData.orgId)
    const response = await owner.request(
      `/api/matters/${seedData.matterId}/shares`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          granteeUserId: seedData.memberId,
          accessLevel: 'view',
        }),
      },
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation_failed')

    const shares = await pool.query<{ n: number }>(
      `select count(*)::int as n from matter_shares where grantee_user_id = $1`,
      [seedData.memberId],
    )
    expect(shares.rows[0]?.n).toBe(0)
  })

  it('revokes a share granted concurrently with the removal', async () => {
    // Re-seat the member so the concurrent grant is valid when it starts.
    await pool.query(
      `update users set "organisationId" = $1, role = 'member', "updatedAt" = now()
       where id = $2`,
      [seedData.orgId, seedData.memberId],
    )
    const owner = app(pool, seedData.ownerId, seedData.orgId)

    // Hold FOR SHARE on the member: the grant's own FOR SHARE is compatible,
    // so the grant commits, while the removal's FOR UPDATE cannot start until
    // the gate releases. That forces the removal to run its revocation against
    // a share that already exists.
    const gate: PoolClient = await gatePool.connect()
    try {
      await gate.query('begin')
      await gate.query(`select id from users where id = $1 for share`, [
        seedData.memberId,
      ])

      const grant = await owner.request(
        `/api/matters/${seedData.matterId}/shares`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            granteeUserId: seedData.memberId,
            accessLevel: 'edit',
          }),
        },
      )
      expect(grant.status).toBe(201)

      const removalPromise = owner.request(
        `/api/organisations/${seedData.orgId}/members/${seedData.memberId}`,
        { method: 'DELETE' },
      )

      const deadline = Date.now() + 3000
      let blocked = false
      while (Date.now() < deadline) {
        const waiting = await pool.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
           where datname = current_database()
             and wait_event_type = 'Lock'
             and query ilike '%from users%'
             and query ilike '%for update%'`,
        )
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          blocked = true
          break
        }
        await delay(20)
      }
      expect(blocked).toBe(true)

      await gate.query('commit')

      const removal = await removalPromise
      expect(removal.status).toBe(200)

      const remaining = await pool.query<{ n: number }>(
        `select count(*)::int as n from matter_shares where grantee_user_id = $1 and organisation_id = $2`,
        [seedData.memberId, seedData.orgId],
      )
      expect(remaining.rows[0]?.n).toBe(0)

      const member = await pool.query<{ organisationId: string | null }>(
        `select "organisationId" from users where id = $1`,
        [seedData.memberId],
      )
      expect(member.rows[0]?.organisationId).toBeNull()
    } finally {
      await gate.query('rollback').catch(() => undefined)
      gate.release()
    }
  })
})
