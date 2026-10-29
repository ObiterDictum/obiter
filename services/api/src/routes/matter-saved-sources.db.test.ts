import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createTestPool } from '../test-database.test-support'
import { createMatterSavedSourcesRoutes } from './matter-saved-sources'
import { waitForLockWait } from './matter-lock-race.test-support'

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
  await pool.query(
    'delete from matter_saved_sources where organisation_id = $1',
    [seed.orgId],
  )
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
        (await stranger.request(`/api/matters/${seed.matterId}/saved-sources`))
          .status,
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

  it('refuses a save queued behind a share revocation', async () => {
    const seed = await seedMatter()
    const writerPool = createTestPool()
    const blocker = await pool.connect()
    let pending: Promise<Response> | undefined
    try {
      await pool.query(
        "update matter_shares set access_level = 'edit' where matter_id = $1",
        [seed.matterId],
      )
      const asEditor = app(writerPool, {
        id: seed.viewerId,
        organisationId: seed.orgId,
        role: 'member',
      })
      const path = `/api/matters/${seed.matterId}/saved-sources`
      const request = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sourceBody),
      }
      expect((await asEditor.request(path, request)).status).toBe(201)
      await pool.query(
        'delete from matter_saved_sources where matter_id = $1',
        [seed.matterId],
      )
      const backend = await writerPool.query<{ pid: number }>(
        'select pg_backend_pid() as pid',
      )
      const pid = backend.rows[0]?.pid
      if (!pid) throw new Error('Writer backend missing')
      await blocker.query('begin')
      await blocker.query('select id from matters where id = $1 for update', [
        seed.matterId,
      ])
      pending = Promise.resolve(asEditor.request(path, request))
      await waitForLockWait(pool, pid)
      await blocker.query(
        'delete from matter_shares where matter_id = $1 and grantee_user_id = $2',
        [seed.matterId, seed.viewerId],
      )
      await blocker.query('commit')
      expect((await pending).status).toBe(404)
      const saved = await pool.query(
        'select id from matter_saved_sources where matter_id = $1',
        [seed.matterId],
      )
      expect(saved.rows).toHaveLength(0)
    } finally {
      await blocker.query('rollback')
      blocker.release()
      await pending
      await writerPool.end()
      await cleanup(seed)
    }
  })

  it('rolls back source saves and removals when the audit insert fails', async () => {
    const seed = await seedMatter()
    const triggerName = `qa_audit_${seed.matterId}`
    try {
      const asOwner = app(pool, owner(seed))
      const path = `/api/matters/${seed.matterId}/saved-sources`
      await pool.query(`create function ${triggerName}() returns trigger language plpgsql as $$
        begin
          if new.organisation_id = TG_ARGV[0] then raise exception 'synthetic audit failure'; end if;
          return new;
        end $$`)
      await pool.query(`create trigger ${triggerName} before insert on audit_logs
        for each row execute function ${triggerName}('${seed.orgId}')`)
      const failedSave = await asOwner.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sourceBody),
      })
      expect(failedSave.status).toBe(500)
      const afterFailure = await pool.query(
        'select id from matter_saved_sources where matter_id = $1',
        [seed.matterId],
      )
      expect(afterFailure.rows).toHaveLength(0)
      await pool.query(`drop trigger ${triggerName} on audit_logs`)
      const created = await asOwner.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sourceBody),
      })
      expect(created.status).toBe(201)
      const body = (await created.json()) as { savedSource: { id: string } }
      await pool.query(`create trigger ${triggerName} before insert on audit_logs
        for each row execute function ${triggerName}('${seed.orgId}')`)
      const failedRemove = await asOwner.request(
        `${path}/${body.savedSource.id}`,
        { method: 'DELETE' },
      )
      expect(failedRemove.status).toBe(500)
      const kept = await pool.query(
        'select id from matter_saved_sources where matter_id = $1 and deleted_at is null',
        [seed.matterId],
      )
      expect(kept.rows).toHaveLength(1)
    } finally {
      await pool.query(`drop trigger if exists ${triggerName} on audit_logs`)
      await pool.query(`drop function if exists ${triggerName}()`)
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
