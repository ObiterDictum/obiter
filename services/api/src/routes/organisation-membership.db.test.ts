import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthzVariables } from '../authz'
import { createTestApiEnv } from '../test-api-env'
import { createOrganisationsRoutes } from './organisations'

function app(pool: Pool, userId: string, organisationId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_membership_db')
    context.set('user', { id: userId, organisationId, role: 'owner' })
    await next()
  })
  routes.route('/', createOrganisationsRoutes(pool, createTestApiEnv()))
  return routes
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

interface MembershipDbSeed {
  orgId: string
  userA: string
  userB: string
  inviteId: string
  auditId: string
}

async function seedMembership(pool: Pool): Promise<MembershipDbSeed> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const seed: MembershipDbSeed = {
    orgId: `org_mem_${suffix}`,
    userA: `usr_mem_${suffix}_a`,
    userB: `usr_mem_${suffix}_b`,
    inviteId: `inv_mem_${suffix}`,
    auditId: `aud_mem_${suffix}`,
  }
  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [seed.orgId, `Membership Org ${suffix}`],
  )
  for (const [userId, label] of [
    [seed.userA, 'A'],
    [seed.userB, 'B'],
  ] as const) {
    await pool.query(
      `insert into users (
         id, name, email, "emailVerified", "organisationId", role,
         "createdAt", "updatedAt"
       )
       values ($1, $2, $3, true, $4, 'owner', now(), now())`,
      [
        userId,
        `Membership User ${label}`,
        `mem-${suffix}-${label}@example.com`,
        seed.orgId,
      ],
    )
  }
  await pool.query(
    `insert into organisation_invites (
       id, organisation_id, email, role, token_hash, expires_at, created_by
     )
     values ($1, $2, $3, 'member', $4, now() + interval '7 days', $5)`,
    [
      seed.inviteId,
      seed.orgId,
      `mem-${suffix}-invite@example.com`,
      `hash_mem_${suffix}`,
      seed.userA,
    ],
  )
  await pool.query(
    `insert into audit_logs (
       id, organisation_id, user_id, entity_type, entity_id, action,
       metadata_json, request_id, created_at
     )
     values ($1, $2, $3, 'organisation', $2, 'organisation.create', '{}'::jsonb, $4, now())`,
    [seed.auditId, seed.orgId, seed.userA, `req_mem_${suffix}`],
  )
  return seed
}

async function cleanupMembership(pool: Pool, seed: MembershipDbSeed) {
  await pool.query(`delete from organisation_invites where id = $1`, [
    seed.inviteId,
  ])
  await pool.query(`delete from audit_logs where id = $1`, [seed.auditId])
  await pool.query(`delete from users where id = any($1::text[])`, [
    [seed.userA, seed.userB],
  ])
  await pool.query(`delete from organisations where id = $1`, [seed.orgId])
}

describe('organisation member removal concurrency (Postgres)', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for organisation-membership.db.test.ts',
    )
  }

  const pool = new Pool({ connectionString })
  const gatePool = new Pool({ connectionString })
  let seed: MembershipDbSeed
  let gate: PoolClient | null = null

  beforeAll(async () => {
    seed = await seedMembership(pool)
  })

  afterAll(async () => {
    if (gate) {
      await gate.query('rollback').catch(() => undefined)
      gate.release()
      gate = null
    }
    if (seed) await cleanupMembership(pool, seed)
    await pool.end()
    await gatePool.end()
  })

  it('serialises concurrent removals of two owners and keeps one owner', async () => {
    for (let round = 0; round < 5; round += 1) {
      await pool.query(
        `update users
         set "organisationId" = $1, role = 'owner', "updatedAt" = now()
         where id = any($2::text[])`,
        [seed.orgId, [seed.userA, seed.userB]],
      )

      const gateClient = await gatePool.connect()
      gate = gateClient
      const requests: Array<Response | Promise<Response>> = []
      try {
        await gateClient.query('begin')
        // Hold the owner set so both removals read it before either mutates it.
        await gateClient.query(
          `
            select id
            from users
            where "organisationId" = $1 and role = 'owner'
            order by id
            for update
          `,
          [seed.orgId],
        )

        requests.push(
          app(pool, seed.userA, seed.orgId).request(
            `/api/organisations/${seed.orgId}/members/${seed.userB}`,
            { method: 'DELETE' },
          ),
          app(pool, seed.userB, seed.orgId).request(
            `/api/organisations/${seed.orgId}/members/${seed.userA}`,
            { method: 'DELETE' },
          ),
        )

        // Both removal transactions must be parked on a lock over the owner
        // rows before the gate is released. Otherwise one can finish before
        // the other reads the owner set and the round proves nothing. The
        // filter covers the owner-set lock and the target-row lock alike, so
        // the test still detects a regression that drops the owner-set lock.
        const deadline = Date.now() + 3000
        let blocked = 0
        while (Date.now() < deadline) {
          const waiting = await pool.query<{ blocked: string }>(
            `
              select count(*)::text as blocked
              from pg_stat_activity
              where datname = current_database()
                and wait_event_type = 'Lock'
                and query ilike '%from users%'
                and query ilike '%for update%'
            `,
          )
          blocked = Number(waiting.rows[0]?.blocked ?? 0)
          if (blocked >= 2) break
          await delay(20)
        }
        expect(blocked).toBe(2)

        await gateClient.query('commit')
        gate = null

        const responses = await withTimeout(
          Promise.all(requests),
          5000,
          `round ${round} concurrent removals`,
        )
        const statuses = responses
          .map((response) => response.status)
          .sort((left, right) => left - right)
        expect(statuses).toEqual([200, 403])
        const forbidden = responses.find((response) => response.status === 403)
        if (!forbidden) throw new Error('expected one 403 response')
        expect(await forbidden.json()).toMatchObject({
          error: { code: 'forbidden' },
        })

        const owners = await pool.query<{ id: string }>(
          `select id from users where "organisationId" = $1 and role = 'owner'`,
          [seed.orgId],
        )
        expect(owners.rows).toHaveLength(1)
        expect([seed.userA, seed.userB]).toContain(owners.rows[0]?.id)
      } finally {
        if (gate) {
          await gate.query('rollback').catch(() => undefined)
          gate = null
        }
        gateClient.release()
        await Promise.allSettled(requests)
      }
    }
  }, 30_000)
})
