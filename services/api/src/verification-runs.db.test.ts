import { Hono } from 'hono'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthzVariables } from './authz'
import { runMigrations } from './migrate'
import { createVerificationRunRoutes } from './routes/verification-runs'
import {
  cleanupOrganisationIsolation,
  seedOrganisationIsolation,
  type OrganisationIsolationSeed,
} from './routes/organisation-isolation.seed'

const storage = {
  readText: async () => {
    throw new Error('isolation tests must not read storage')
  },
  writeText: async () => undefined,
  readBinary: async () => {
    throw new Error('isolation tests must not read storage')
  },
  writeBinary: async () => undefined,
  delete: async () => undefined,
}

function app(pool: Pool, userId: string, organisationId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_verify_db')
    context.set('user', { id: userId, organisationId, role: 'owner' })
    await next()
  })
  routes.route('/', createVerificationRunRoutes(pool, storage))
  return routes
}

describe('verification run persistence', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for verification-runs.db.test.ts',
    )
  }

  const pool = new Pool({ connectionString })
  let seed: OrganisationIsolationSeed

  beforeAll(async () => {
    await runMigrations(pool)
    seed = await seedOrganisationIsolation(pool)
  })

  afterAll(async () => {
    if (seed) await cleanupOrganisationIsolation(pool, seed)
    await pool.end()
  })

  it('rejects a second live run for the same version', async () => {
    await pool.query(
      `insert into verification_runs (
         id, organisation_id, matter_id, document_id, document_version_id,
         status, created_by, created_at
       ) values ($1, $2, $3, $4, $5, 'queued', $6, now())`,
      [
        `vrun_${seed.suffix}_a`,
        seed.orgA,
        seed.matterA,
        seed.documentA,
        seed.versionA,
        seed.userA,
      ],
    )
    await expect(
      pool.query(
        `insert into verification_runs (
           id, organisation_id, matter_id, document_id, document_version_id,
           status, created_by, created_at
         ) values ($1, $2, $3, $4, $5, 'queued', $6, now())`,
        [
          `vrun_${seed.suffix}_a2`,
          seed.orgA,
          seed.matterA,
          seed.documentA,
          seed.versionA,
          seed.userA,
        ],
      ),
    ).rejects.toThrow(/verification_runs_one_live_per_version/)
  })

  it('refuses findings attached to another organisation run', async () => {
    await expect(
      pool.query(
        `insert into verification_findings (
           run_id, finding_id, organisation_id, finding_type, status_state,
           payload_json
         ) values (
           $1, 'vf:x', $2, 'citation_resolution', 'not_checked', '{}'::jsonb
         )`,
        [`vrun_${seed.suffix}_a`, seed.orgB],
      ),
    ).rejects.toThrow()
  })

  it('keeps concurrent inserts to one live row', async () => {
    const versionB = seed.versionB
    const inserts = [0, 1].map((index) =>
      pool.query(
        `insert into verification_runs (
           id, organisation_id, matter_id, document_id, document_version_id,
           status, created_by, created_at
         ) values ($1, $2, $3, $4, $5, 'queued', $6, now())
         on conflict (organisation_id, document_id, document_version_id)
           where deleted_at is null
         do nothing`,
        [
          `vrun_${seed.suffix}_b${index}`,
          seed.orgB,
          seed.matterB,
          seed.documentB,
          versionB,
          seed.userB,
        ],
      ),
    )
    await Promise.all(inserts)
    const rows = await pool.query<{ id: string }>(
      `select id from verification_runs
       where organisation_id = $1 and document_version_id = $2 and deleted_at is null`,
      [seed.orgB, versionB],
    )
    expect(rows.rows).toHaveLength(1)
  })

  it('hides organisation B runs and documents from organisation A callers', async () => {
    const runId = `vrun_${seed.suffix}_bhttp`
    await pool.query(
      `insert into verification_runs (
         id, organisation_id, matter_id, document_id, document_version_id,
         status, created_by, created_at, started_at, completed_at
       ) values ($1, $2, $3, $4, $5, 'completed', $6, now(), now(), now())
       on conflict (organisation_id, document_id, document_version_id)
         where deleted_at is null
       do nothing`,
      [
        runId,
        seed.orgB,
        seed.matterB,
        seed.documentB,
        seed.versionB,
        seed.userB,
      ],
    )
    const existing = await pool.query<{ id: string }>(
      `select id from verification_runs
       where organisation_id = $1 and document_id = $2 and deleted_at is null`,
      [seed.orgB, seed.documentB],
    )
    const hiddenId = existing.rows[0]?.id
    expect(hiddenId).toBeDefined()
    const userA = app(pool, seed.userA, seed.orgA)
    const hidden = [seed.orgB, seed.documentB, hiddenId!]
    const byId = await userA.request(`/api/verification-runs/${hiddenId}`)
    const body = await byId.text()
    expect([403, 404]).toContain(byId.status)
    for (const needle of hidden) expect(body).not.toContain(needle)

    const findings = await userA.request(
      `/api/verification-runs/${hiddenId}/findings`,
    )
    const findingsBody = await findings.text()
    expect([403, 404]).toContain(findings.status)
    for (const needle of hidden) expect(findingsBody).not.toContain(needle)

    const create = await userA.request(
      `/api/documents/${seed.documentB}/verification-runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId: seed.versionB }),
      },
    )
    const createBody = await create.text()
    expect([403, 404]).toContain(create.status)
    expect(createBody).not.toContain(seed.orgB)
  })
})
