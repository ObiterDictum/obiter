import { createHash, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { Pool } from 'pg'
import { createTestPool } from '../test-database.test-support'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createTestApiEnv } from '../test-api-env'
import { createOrganisationsRoutes } from './organisations'

/**
 * The invite-accept path moves a user between organisations with the composite
 * grantee key from 0027 in place. A user whose current organisation still holds
 * work (a matter, another member, an invite, a run or an artifact) cannot move,
 * so an existing share survives untouched; a user with no work and no shares
 * moves and the vacated organisation is removed.
 */

const REQUEST_ID = 'req_invite_share_transition'

interface RouteUser extends AuthzUser {
  email?: string
  emailVerified?: boolean
}

function app(pool: Pool, user: RouteUser) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', REQUEST_ID)
    context.set('user', user)
    await next()
  })
  routes.route('/', createOrganisationsRoutes(pool, createTestApiEnv()))
  return routes
}

interface InviteSeed {
  targetOrgId: string
  targetOwnerId: string
  stayOrgId: string
  stayOwnerId: string
  memberId: string
  memberEmail: string
  matterId: string
  shareId: string
  inviteId: string
  token: string
  soloOrgId: string
  soloUserId: string
  soloUserEmail: string
  soloInviteId: string
  soloToken: string
}

async function seed(pool: Pool): Promise<InviteSeed> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const seed: InviteSeed = {
    targetOrgId: `org_inv_${suffix}_target`,
    targetOwnerId: `usr_inv_${suffix}_target`,
    stayOrgId: `org_inv_${suffix}_stay`,
    stayOwnerId: `usr_inv_${suffix}_stayowner`,
    memberId: `usr_inv_${suffix}_member`,
    memberEmail: `member-${suffix}@example.com`,
    matterId: `mtr_inv_${suffix}`,
    shareId: `shr_inv_${suffix}`,
    inviteId: `inv_inv_${suffix}`,
    token: `token-inv-${suffix}`,
    soloOrgId: `org_inv_${suffix}_solo`,
    soloUserId: `usr_inv_${suffix}_solo`,
    soloUserEmail: `solo-${suffix}@example.com`,
    soloInviteId: `inv_solo_${suffix}`,
    soloToken: `token-solo-${suffix}`,
  }
  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now()), ($3, $4, now(), now()), ($5, $6, now(), now())`,
    [
      seed.targetOrgId,
      `Invite target ${suffix}`,
      seed.stayOrgId,
      `Invite stay ${suffix}`,
      seed.soloOrgId,
      `Invite solo ${suffix}`,
    ],
  )
  await pool.query(
    `insert into users (
       id, name, email, "emailVerified", "organisationId", role,
       "createdAt", "updatedAt"
     )
     values
       ($1, 'Target Owner', $2, true, $3, 'owner', now(), now()),
       ($4, 'Stay Owner', $5, true, $6, 'owner', now(), now()),
       ($7, 'Member', $8, true, $6, 'member', now(), now()),
       ($9, 'Solo Owner', $10, true, $11, 'owner', now(), now())`,
    [
      seed.targetOwnerId,
      `target-${suffix}@example.com`,
      seed.targetOrgId,
      seed.stayOwnerId,
      `stay-owner-${suffix}@example.com`,
      seed.stayOrgId,
      seed.memberId,
      seed.memberEmail,
      seed.soloUserId,
      seed.soloUserEmail,
      seed.soloOrgId,
    ],
  )
  await pool.query(
    `insert into matters (
       id, organisation_id, name, description, primary_jurisdiction,
       secondary_jurisdictions, legal_domains, client_reference,
       status, created_by, created_at, updated_at
     )
     values ($1, $2, $3, null, 'england_and_wales', '[]'::jsonb, '[]'::jsonb, '',
       'active', $4, now(), now())`,
    [seed.matterId, seed.stayOrgId, `Stay matter ${suffix}`, seed.stayOwnerId],
  )
  await pool.query(
    `insert into matter_shares (
       id, organisation_id, matter_id, grantee_user_id, access_level,
       created_by, created_at
     )
     values ($1, $2, $3, $4, 'view', $5, now())`,
    [
      seed.shareId,
      seed.stayOrgId,
      seed.matterId,
      seed.memberId,
      seed.stayOwnerId,
    ],
  )
  await pool.query(
    `insert into organisation_invites (
       id, organisation_id, email, role, token_hash, expires_at, created_by
     )
     values ($1, $2, $3, 'member', $4, now() + interval '7 days', $5)`,
    [
      seed.inviteId,
      seed.targetOrgId,
      seed.memberEmail,
      createHash('sha256').update(seed.token).digest('hex'),
      seed.targetOwnerId,
    ],
  )
  await pool.query(
    `insert into organisation_invites (
       id, organisation_id, email, role, token_hash, expires_at, created_by
     )
     values ($1, $2, $3, 'member', $4, now() + interval '7 days', $5)`,
    [
      seed.soloInviteId,
      seed.targetOrgId,
      seed.soloUserEmail,
      createHash('sha256').update(seed.soloToken).digest('hex'),
      seed.targetOwnerId,
    ],
  )
  return seed
}

async function cleanup(pool: Pool, seed: InviteSeed) {
  await pool.query(`delete from audit_logs where request_id = $1`, [REQUEST_ID])
  await pool.query(
    `delete from organisation_invites where id = any($1::text[])`,
    [[seed.inviteId, seed.soloInviteId]],
  )
  await pool.query(`delete from matter_shares where id = $1`, [seed.shareId])
  await pool.query(`delete from matters where id = $1`, [seed.matterId])
  await pool.query(`delete from users where id = any($1::text[])`, [
    [seed.targetOwnerId, seed.stayOwnerId, seed.memberId, seed.soloUserId],
  ])
  await pool.query(`delete from organisations where id = any($1::text[])`, [
    [seed.targetOrgId, seed.stayOrgId, seed.soloOrgId],
  ])
}

describe('invite acceptance with an existing matter share (db)', () => {
  const pool = createTestPool()
  let seedData: InviteSeed

  beforeAll(async () => {
    seedData = await seed(pool)
  })

  afterAll(async () => {
    await cleanup(pool, seedData)
    await pool.end()
  })

  it('refuses the move and preserves the share when the organisation holds work', async () => {
    const member = app(pool, {
      id: seedData.memberId,
      organisationId: seedData.stayOrgId,
      role: 'member',
      email: seedData.memberEmail,
      emailVerified: true,
    })
    const response = await member.request('/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: seedData.token }),
    })
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('organisation_not_empty')

    const user = await pool.query<{ organisationId: string | null }>(
      `select "organisationId" from users where id = $1`,
      [seedData.memberId],
    )
    expect(user.rows[0]?.organisationId).toBe(seedData.stayOrgId)

    const share = await pool.query<{ n: number }>(
      `select count(*)::int as n from matter_shares where id = $1`,
      [seedData.shareId],
    )
    expect(share.rows[0]?.n).toBe(1)
  })

  it('moves a member with no shares and no work into the target organisation', async () => {
    const solo = app(pool, {
      id: seedData.soloUserId,
      organisationId: seedData.soloOrgId,
      role: 'owner',
      email: seedData.soloUserEmail,
      emailVerified: true,
    })
    const response = await solo.request('/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: seedData.soloToken }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      organisationId: seedData.targetOrgId,
      role: 'member',
    })

    const user = await pool.query<{ organisationId: string | null }>(
      `select "organisationId" from users where id = $1`,
      [seedData.soloUserId],
    )
    expect(user.rows[0]?.organisationId).toBe(seedData.targetOrgId)

    // The vacated, empty organisation is removed by the accept path.
    const vacated = await pool.query<{ n: number }>(
      `select count(*)::int as n from organisations where id = $1`,
      [seedData.soloOrgId],
    )
    expect(vacated.rows[0]?.n).toBe(0)
  })
})
