import { Hono } from 'hono'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  verificationFindingsResponseSchema,
  verificationRunResponseSchema,
} from '@obiter/contracts'
import type { AuthzVariables } from './authz'
import { createVerificationRunRoutes } from './routes/verification-runs'
import {
  cleanupOrganisationIsolation,
  seedOrganisationIsolation,
  type OrganisationIsolationSeed,
} from './routes/organisation-isolation.seed'
import {
  clearCaseLawFinding,
  insertFinding,
  insertReadyVersion,
  reviewRequiredFinding,
  type Subject,
} from './verification-runs.test-support'

const extraVersions: string[] = []

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
    // The test database is migrated before the suite runs (CI applies the SQL
    // files directly), so this suite assumes the schema, like the other
    // database-backed suites here. It must not call runMigrations: that would
    // re-apply 0003 against a schema 0019 has already dropped search_vector
    // from, because the pre-applied migrations are absent from
    // schema_migrations.
    seed = await seedOrganisationIsolation(pool)
  })

  afterAll(async () => {
    if (extraVersions.length > 0) {
      await pool.query(
        `delete from audit_logs
         where entity_type = 'verification_run'
           and entity_id in (
             select id from verification_runs
             where document_version_id = any($1::text[])
           )`,
        [extraVersions],
      )
      await pool.query(
        `delete from verification_findings
         where run_id in (
           select id from verification_runs
           where document_version_id = any($1::text[])
         )`,
        [extraVersions],
      )
      await pool.query(
        `delete from verification_runs where document_version_id = any($1::text[])`,
        [extraVersions],
      )
      await pool.query(
        `delete from document_versions where id = any($1::text[])`,
        [extraVersions],
      )
    }
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

  it('collapses duplicate creates onto one run for the immutable version', async () => {
    const version = `ver_iso_${seed.suffix}_a2`
    await insertReadyVersion(pool, seed, version, 2)
    extraVersions.push(version)
    const userA = app(pool, seed.userA, seed.orgA)
    const create = () =>
      userA.request(`/api/documents/${seed.documentA}/verification-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId: version }),
      })

    const first = verificationRunResponseSchema.parse(
      await (await create()).json(),
    )
    const second = verificationRunResponseSchema.parse(
      await (await create()).json(),
    )

    expect(first.run.documentVersionId).toBe(version)
    expect(first.run.id).toBe(second.run.id)
    expect(first.run.status).toBe('failed')
    expect(first.run.failureCode).toBe('model_unavailable')

    const rows = await pool.query<{ id: string }>(
      `select id from verification_runs
       where organisation_id = $1
         and document_version_id = $2
         and deleted_at is null`,
      [seed.orgA, version],
    )
    expect(rows.rows).toHaveLength(1)

    const creates = await pool.query<{ count: string }>(
      `select count(*)::text as count from audit_logs
       where entity_type = 'verification_run'
         and entity_id = $1
         and action = 'verification.run_create'`,
      [first.run.id],
    )
    expect(creates.rows[0]?.count).toBe('1')
  })

  it('refuses a version id that belongs to another document', async () => {
    const userA = app(pool, seed.userA, seed.orgA)
    const response = await userA.request(
      `/api/documents/${seed.documentA}/verification-runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId: seed.versionB }),
      },
    )
    expect([403, 404]).toContain(response.status)
    expect(await response.text()).not.toContain(seed.versionB)
    const rows = await pool.query<{ id: string }>(
      `select id from verification_runs
       where organisation_id = $1 and document_version_id = $2`,
      [seed.orgA, seed.versionB],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('records a failed run and exposes no internal error text', async () => {
    const version = `ver_iso_${seed.suffix}_a4`
    await insertReadyVersion(pool, seed, version, 4)
    extraVersions.push(version)
    const userA = app(pool, seed.userA, seed.orgA)
    const created = verificationRunResponseSchema.parse(
      await (
        await userA.request(
          `/api/documents/${seed.documentA}/verification-runs`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ versionId: version }),
          },
        )
      ).json(),
    )
    expect(created.run.status).toBe('failed')

    const response = await userA.request(
      `/api/verification-runs/${created.run.id}`,
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('must not read storage')
    expect(text).not.toContain('DocumentModelStoreError')
    const body = verificationRunResponseSchema.parse(JSON.parse(text))
    expect(body.run.failureCode).toBe('model_unavailable')

    const findings = verificationFindingsResponseSchema.parse(
      await (
        await userA.request(`/api/verification-runs/${created.run.id}/findings`)
      ).json(),
    )
    expect(findings.findings).toEqual([])

    const audit = await pool.query<{
      action: string
      metadata_json: Record<string, unknown>
    }>(
      `select action, metadata_json from audit_logs
       where entity_type = 'verification_run' and entity_id = $1`,
      [created.run.id],
    )
    const actions = audit.rows.map((row) => row.action)
    expect(actions).toContain('verification.run_create')
    expect(actions).toContain('verification.run_fail')
    // Audit carries identifiers and counts only, never finding text.
    for (const row of audit.rows) {
      expect(Object.keys(row.metadata_json).sort()).toEqual([
        'documentId',
        'findingCount',
        'status',
        'versionId',
      ])
    }
  })

  it('reads back a completed run and its findings with evidence', async () => {
    const version = `ver_iso_${seed.suffix}_a3`
    await insertReadyVersion(pool, seed, version, 3)
    extraVersions.push(version)
    const runId = `vrun_${seed.suffix}_readback`
    await pool.query(
      `insert into verification_runs (
         id, organisation_id, matter_id, document_id, document_version_id,
         status, failure_code, created_by, created_at, started_at, completed_at
       ) values ($1, $2, $3, $4, $5, 'completed', null, $6, now(), now(), now())`,
      [runId, seed.orgA, seed.matterA, seed.documentA, version, seed.userA],
    )
    const subject: Subject = { documentId: seed.documentA, versionId: version }
    await insertFinding(pool, seed.orgA, runId, clearCaseLawFinding(subject))
    await insertFinding(pool, seed.orgA, runId, reviewRequiredFinding(subject))

    const userA = app(pool, seed.userA, seed.orgA)
    const runResponse = await userA.request(`/api/verification-runs/${runId}`)
    expect(runResponse.status).toBe(200)
    const run = verificationRunResponseSchema.parse(await runResponse.json())
    expect(run.run.status).toBe('completed')
    expect(run.run.documentVersionId).toBe(version)
    expect(run.run.stale).toBe(true)
    expect(run.run.summary).toEqual({
      findingCount: 2,
      flaggedCount: 0,
      reviewRequiredCount: 1,
    })

    const findingsResponse = await userA.request(
      `/api/verification-runs/${runId}/findings`,
    )
    expect(findingsResponse.status).toBe(200)
    const findings = verificationFindingsResponseSchema.parse(
      await findingsResponse.json(),
    )
    expect(findings.findings).toHaveLength(2)
    const clear = findings.findings.find((finding) => finding.state === 'clear')
    expect(clear?.evidence).toEqual([
      {
        id: 'uksc-1:judgment_document',
        sourceId: 'uksc-1',
        label: 'Judgment uksc-1',
      },
    ])
    const review = findings.findings.find(
      (finding) => finding.state === 'review_required',
    )
    expect(review?.reviewReason).toBe('citation_unresolved')
    expect(review?.requiresReview).toBe(true)
    expect(review?.evidence).toEqual([])
  })
})
