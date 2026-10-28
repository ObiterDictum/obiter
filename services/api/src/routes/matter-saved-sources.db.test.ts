import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createTestPool } from '../test-database.test-support'
import { createMatterSavedSourcesRoutes } from './matter-saved-sources'

/**
 * Saved sources belong to one matter in one organisation. These cases drive
 * the routes against a real database because the whole guarantee is the
 * authorisation join: a stranger with a valid matter and saved-source id must
 * still see nothing, and saving is a write, so a view share cannot do it.
 */

const pool = createTestPool()

afterAll(async () => {
  await pool.end()
})

interface Seed {
  orgId: string
  otherOrgId: string
  ownerId: string
  viewerId: string
  strangerId: string
  matterId: string
  otherMatterId: string
}

async function seedMatter(): Promise<Seed> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const seed: Seed = {
    orgId: `org_svs_${suffix}`,
    otherOrgId: `org_svs_${suffix}_other`,
    ownerId: `usr_svs_${suffix}_owner`,
    viewerId: `usr_svs_${suffix}_viewer`,
    strangerId: `usr_svs_${suffix}_stranger`,
    matterId: `mtr_svs_${suffix}`,
    otherMatterId: `mtr_svs_${suffix}_other`,
  }
  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now()), ($3, $4, now(), now())`,
    [seed.orgId, `Saved ${suffix}`, seed.otherOrgId, `Other ${suffix}`],
  )
  await pool.query(
    `insert into users (
       id, name, email, "emailVerified", "organisationId", role,
       "createdAt", "updatedAt"
     ) values
       ($1, $2, $3, true, $4, 'owner', now(), now()),
       ($5, $6, $7, true, $4, 'member', now(), now()),
       ($8, $9, $10, true, $11, 'member', now(), now())`,
    [
      seed.ownerId,
      'Saved Owner',
      `${seed.ownerId}@example.com`,
      seed.orgId,
      seed.viewerId,
      'Saved Viewer',
      `${seed.viewerId}@example.com`,
      seed.strangerId,
      'Saved Stranger',
      `${seed.strangerId}@example.com`,
      seed.otherOrgId,
    ],
  )
  await pool.query(
    `insert into matters (
       id, organisation_id, name, primary_jurisdiction, created_by,
       created_at, updated_at
     ) values
       ($1, $2, $3, 'england-and-wales', $4, now(), now()),
       ($5, $6, $7, 'england-and-wales', $4, now(), now())`,
    [
      seed.matterId,
      seed.orgId,
      `Saved matter ${suffix}`,
      seed.ownerId,
      seed.otherMatterId,
      seed.otherOrgId,
      `Other matter ${suffix}`,
    ],
  )
  await pool.query(
    `insert into matter_shares (
       organisation_id, matter_id, grantee_user_id, access_level, created_by
     ) values ($1, $2, $3, 'view', $4)`,
    [seed.orgId, seed.matterId, seed.viewerId, seed.ownerId],
  )
  return seed
}

async function cleanup(seed: Seed) {
  await pool.query('delete from audit_logs where organisation_id = any($1)', [
    [seed.orgId, seed.otherOrgId],
  ])
  await pool.query('delete from matter_saved_sources where organisation_id = $1', [
    seed.orgId,
  ])
  await pool.query('delete from matter_shares where organisation_id = $1', [
    seed.orgId,
  ])
  await pool.query('delete from matters where organisation_id = any($1)', [
    [seed.orgId, seed.otherOrgId],
  ])
  await pool.query('delete from users where id = any($1)', [
    [seed.ownerId, seed.viewerId, seed.strangerId],
  ])
  await pool.query('delete from organisations where id = any($1)', [
    [seed.orgId, seed.otherOrgId],
  ])
}

const sourceBody = {
  kind: 'judgment',
  sourceId: 'uksc/2018/24',
  title: 'Rock Advertising Ltd v MWB Business Exchange Centres Ltd',
  citation: '[2018] UKSC 24',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2018/24',
}

function app(db: Pool, user: AuthzUser) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_saved_sources')
    c.set('user', user)
    await next()
  })
  routes.route('/', createMatterSavedSourcesRoutes(db))
  return routes
}

function owner(seed: Seed): AuthzUser {
  return { id: seed.ownerId, organisationId: seed.orgId, role: 'owner' }
}

describe('matter saved sources', () => {
  it('saves a source once, lists it, and hides it from another organisation', async () => {
    const seed = await seedMatter()
    try {
      const asOwner = app(pool, owner(seed))
      const created = await asOwner.request(
        `/api/matters/${seed.matterId}/saved-sources`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sourceBody),
        },
      )
      expect(created.status).toBe(201)
      const { savedSource } = (await created.json()) as {
        savedSource: { id: string; sourceId: string }
      }
      expect(savedSource.sourceId).toBe(sourceBody.sourceId)

      // Filing the same source again revives one row rather than adding a
      // second entry.
      const again = await asOwner.request(
        `/api/matters/${seed.matterId}/saved-sources`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sourceBody),
        },
      )
      expect(again.status).toBe(201)
      const listed = await asOwner.request(
        `/api/matters/${seed.matterId}/saved-sources`,
      )
      expect(listed.status).toBe(200)
      const { savedSources } = (await listed.json()) as {
        savedSources: Array<{ id: string }>
      }
      expect(savedSources).toHaveLength(1)

      // A member of another organisation cannot read or extend it, even with
      // the real matter id.
      const stranger = app(pool, {
        id: seed.strangerId,
        organisationId: seed.otherOrgId,
        role: 'member',
      })
      expect(
        (
          await stranger.request(
            `/api/matters/${seed.matterId}/saved-sources`,
          )
        ).status,
      ).toBe(404)
      expect(
        (
          await stranger.request(
            `/api/matters/${seed.matterId}/saved-sources`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(sourceBody),
            },
          )
        ).status,
      ).toBe(404)

      // Unsaving is a write, so the view-only share cannot do it; the owner
      // can, and the row is soft-deleted out of the list.
      const viewer = app(pool, {
        id: seed.viewerId,
        organisationId: seed.orgId,
        role: 'member',
      })
      expect(
        (
          await viewer.request(
            `/api/matters/${seed.matterId}/saved-sources/${savedSource.id}`,
            { method: 'DELETE' },
          )
        ).status,
      ).toBe(404)
      const removed = await asOwner.request(
        `/api/matters/${seed.matterId}/saved-sources/${savedSource.id}`,
        { method: 'DELETE' },
      )
      expect(removed.status).toBe(200)
      const afterRemoval = await asOwner.request(
        `/api/matters/${seed.matterId}/saved-sources`,
      )
      const remaining = (await afterRemoval.json()) as { savedSources: [] }
      expect(remaining.savedSources).toHaveLength(0)
    } finally {
      await cleanup(seed)
    }
  })

  it('rejects a malformed source instead of storing it', async () => {
    const seed = await seedMatter()
    try {
      const asOwner = app(pool, owner(seed))
      const response = await asOwner.request(
        `/api/matters/${seed.matterId}/saved-sources`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'judgment', sourceId: '', title: '' }),
        },
      )
      expect(response.status).toBe(400)
    } finally {
      await cleanup(seed)
    }
  })
})
