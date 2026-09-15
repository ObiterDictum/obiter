import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import { createTestApiEnv } from './test-api-env'

/**
 * Real-database coverage for the account and organisation settings mutations.
 *
 * `app.test.ts` covers the same routes against a fake pool, which cannot show
 * that the SQL scopes a write to the caller's own row or that a foreign
 * organisation is left untouched. This file drives the real pool through the
 * HTTP boundary, so the statement the route builds is the statement Postgres
 * runs.
 */
type Auth = ReturnType<typeof createAuth>

interface AccountSeed {
  orgA: string
  orgB: string
  ownerA: string
  memberA: string
  ownerB: string
}

describe('account and organisation settings (Postgres)', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for account.db.test.ts (see TESTING.md).',
    )
  }

  const pool = new Pool({ connectionString })
  const env = createTestApiEnv()
  let seed: AccountSeed
  let currentUserId = ''

  /**
   * A session stands in for better-auth so the route, the session scope and
   * the SQL are all real. The bearer/cookie layer is covered by
   * organization-membership.db.test.ts and by the browser pass.
   */
  function app() {
    const account =
      currentUserId === seed.ownerB
        ? { organisationId: seed.orgB, role: 'owner' }
        : currentUserId === seed.memberA
          ? { organisationId: seed.orgA, role: 'member' }
          : currentUserId
            ? { organisationId: seed.orgA, role: 'owner' }
            : null
    const auth = {
      api: {
        getSession: async () =>
          account && currentUserId
            ? {
                user: {
                  id: currentUserId,
                  name: 'Actor',
                  organisationId: account.organisationId,
                  role: account.role,
                },
                session: { id: `ses_${currentUserId}` },
              }
            : null,
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    return createApiApp(env, pool, { auth })
  }

  async function patch(path: string, body: unknown) {
    return app().request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
    seed = {
      orgA: `org_acct_${suffix}_a`,
      orgB: `org_acct_${suffix}_b`,
      ownerA: `usr_acct_${suffix}_owner_a`,
      memberA: `usr_acct_${suffix}_member_a`,
      ownerB: `usr_acct_${suffix}_owner_b`,
    }
    for (const [id, name] of [
      [seed.orgA, `Account Org A ${suffix}`],
      [seed.orgB, `Account Org B ${suffix}`],
    ] as const) {
      await pool.query(
        `insert into organisations (id, name, created_at, updated_at)
         values ($1, $2, now(), now())`,
        [id, name],
      )
    }
    for (const [id, label, organisationId, role] of [
      [seed.ownerA, 'Owner A', seed.orgA, 'owner'],
      [seed.memberA, 'Member A', seed.orgA, 'member'],
      [seed.ownerB, 'Owner B', seed.orgB, 'owner'],
    ] as const) {
      await pool.query(
        `insert into users (
           id, name, email, "emailVerified", "organisationId", role,
           "createdAt", "updatedAt"
         )
         values ($1, $2, $3, true, $4, $5, now(), now())`,
        [id, label, `acct-${suffix}-${id}@example.com`, organisationId, role],
      )
    }
  })

  afterAll(async () => {
    if (!seed) return
    const userIds = [seed.ownerA, seed.memberA, seed.ownerB]
    const organisationIds = [seed.orgA, seed.orgB]
    await pool.query(
      `delete from audit_logs
       where user_id = any($1::text[]) or organisation_id = any($2::text[])`,
      [userIds, organisationIds],
    )
    await pool.query(`delete from sessions where "userId" = any($1::text[])`, [
      userIds,
    ])
    await pool.query(`delete from users where id = any($1::text[])`, [userIds])
    await pool.query(`delete from organisations where id = any($1::text[])`, [
      organisationIds,
    ])
    await pool.end()
  })

  async function nameOf(userId: string) {
    const result = await pool.query<{ name: string }>(
      `select name from users where id = $1`,
      [userId],
    )
    return result.rows[0]?.name
  }

  async function organisationName(organisationId: string) {
    const result = await pool.query<{ name: string }>(
      `select name from organisations where id = $1`,
      [organisationId],
    )
    return result.rows[0]?.name
  }

  it('updates only the signed-in account and audits the change without names', async () => {
    currentUserId = seed.ownerA
    const response = await patch('/api/me', {
      name: '  Rowan Ashcombe  ',
      id: seed.ownerB,
      userId: seed.memberA,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { id: seed.ownerA, name: 'Rowan Ashcombe' },
    })
    expect(await nameOf(seed.ownerA)).toBe('Rowan Ashcombe')
    expect(await nameOf(seed.memberA)).toBe('Member A')
    expect(await nameOf(seed.ownerB)).toBe('Owner B')

    const audit = await pool.query<{
      organisation_id: string | null
      entity_type: string
      metadata_json: unknown
    }>(
      `select organisation_id, entity_type, metadata_json
       from audit_logs
       where entity_id = $1 and action = 'user.profile_update'`,
      [seed.ownerA],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({
      organisation_id: seed.orgA,
      entity_type: 'user',
    })
    const metadata = JSON.stringify(audit.rows[0].metadata_json)
    expect(metadata).not.toContain('Rowan Ashcombe')
    expect(metadata).not.toContain('Owner A')
  })

  it('lets the owner rename their own organisation and leaves the other tenant alone', async () => {
    const foreignBefore = await organisationName(seed.orgB)
    currentUserId = seed.ownerA
    const response = await patch('/api/organisations', {
      name: 'Ashcombe Chambers',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      organisation: { id: seed.orgA, name: 'Ashcombe Chambers' },
    })
    expect(await organisationName(seed.orgA)).toBe('Ashcombe Chambers')
    expect(await organisationName(seed.orgB)).toBe(foreignBefore)
  })

  it('refuses a member the organisation rename and changes nothing', async () => {
    const before = await organisationName(seed.orgA)
    currentUserId = seed.memberA
    const response = await patch('/api/organisations', {
      name: 'Member Takeover',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden' },
    })
    expect(await organisationName(seed.orgA)).toBe(before)
  })

  it('refuses a rename addressed at another organisation', async () => {
    const before = await organisationName(seed.orgB)
    currentUserId = seed.ownerA
    const response = await patch(`/api/organisations/${seed.orgB}`, {
      name: 'Cross Tenant Rename',
    })

    expect(response.status).toBe(403)
    expect(await organisationName(seed.orgB)).toBe(before)
  })

  it('leaves the account name untouched for an unauthorised update', async () => {
    const before = await nameOf(seed.ownerA)
    currentUserId = ''
    const response = await patch('/api/me', { name: 'Anonymous Rename' })

    expect(response.status).toBe(401)
    expect(await nameOf(seed.ownerA)).toBe(before)
  })
})
