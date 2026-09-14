import { Hono } from 'hono'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  verificationFindingsResponseSchema,
  verificationRunListResponseSchema,
  verificationRunResponseSchema,
} from '@obiter/contracts'
import type { AuthzVariables } from './authz'
import { createVerificationFindingId } from '@obiter/verification-core'
import { createVerificationRunRoutes } from './routes/verification-runs'
import {
  cleanupOrganisationIsolation,
  seedOrganisationIsolation,
  type OrganisationIsolationSeed,
} from './routes/organisation-isolation.seed'
import { completeVerificationRun } from './verification-database'
import {
  clearCaseLawFinding,
  insertFinding,
  insertReadyVersion,
  type Subject,
} from './verification-runs.test-support'

const extraVersions: string[] = []

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function throwingStorage() {
  return {
    readText: async () => {
      throw new Error('recovery tests must not read storage')
    },
    writeText: async () => undefined,
    readBinary: async () => {
      throw new Error('recovery tests must not read storage')
    },
    writeBinary: async () => undefined,
    delete: async () => undefined,
  }
}

function app(
  pool: Pool,
  userId: string,
  organisationId: string,
  storage = throwingStorage(),
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_recovery')
    context.set('user', { id: userId, organisationId, role: 'owner' })
    await next()
  })
  routes.route('/', createVerificationRunRoutes(pool, storage))
  return routes
}

describe('verification run recovery and pagination', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for the recovery suite')
  }
  const pool = new Pool({ connectionString })
  let seed: OrganisationIsolationSeed

  async function insertRunningRun(input: {
    id: string
    versionId: string
    leaseSecondsFromNow: number | null
    leaseToken: string
    createdAt?: string
  }) {
    await pool.query(
      `insert into verification_runs (
         id, organisation_id, matter_id, document_id, document_version_id,
         status, created_by, created_at, started_at, lease_token,
         lease_expires_at
       ) values ($1, $2, $3, $4, $5, 'running', $6, coalesce($7::timestamptz, now()),
         now(), $8,
         case when $9::int is null then null else now() + make_interval(secs => $9::int) end)`,
      [
        input.id,
        seed.orgA,
        seed.matterA,
        seed.documentA,
        input.versionId,
        seed.userA,
        input.createdAt ?? null,
        input.leaseToken,
        input.leaseSecondsFromNow,
      ],
    )
  }

  async function runRow(id: string) {
    const result = await pool.query<{
      status: string
      failure_code: string | null
      lease_token: string | null
      completed_at: Date | null
    }>(
      `select status, failure_code, lease_token, completed_at
       from verification_runs where id = $1`,
      [id],
    )
    return result.rows[0]
  }

  async function createRun(versionId: string, storage = throwingStorage()) {
    const response = await app(pool, seed.userA, seed.orgA, storage).request(
      `/api/documents/${seed.documentA}/verification-runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId }),
      },
    )
    return {
      status: response.status,
      body: verificationRunResponseSchema.parse(await response.json()),
    }
  }

  beforeAll(async () => {
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
    await cleanupOrganisationIsolation(pool, seed)
    await pool.end()
  })

  it('does not steal a run whose lease is still live', async () => {
    const version = `ver_rec_${seed.suffix}_live`
    await insertReadyVersion(pool, seed, version, 20)
    extraVersions.push(version)
    await insertRunningRun({
      id: `vrun_${seed.suffix}_live`,
      versionId: version,
      leaseSecondsFromNow: 600,
      leaseToken: 'live-token',
    })
    const created = await createRun(version)
    expect(created.status).toBe(201)
    expect(created.body.run.id).toBe(`vrun_${seed.suffix}_live`)
    expect(created.body.run.status).toBe('running')
    const rows = await pool.query(
      `select id from verification_runs where document_version_id = $1`,
      [version],
    )
    expect(rows.rows).toHaveLength(1)
  })

  it('interrupts an expired run, drops its partial findings, and replaces it', async () => {
    const version = `ver_rec_${seed.suffix}_stale`
    await insertReadyVersion(pool, seed, version, 21)
    extraVersions.push(version)
    const staleId = `vrun_${seed.suffix}_stale`
    await insertRunningRun({
      id: staleId,
      versionId: version,
      leaseSecondsFromNow: -60,
      leaseToken: 'dead-token',
    })
    // A partial attempt left findings behind before the process died.
    const subject: Subject = { documentId: seed.documentA, versionId: version }
    await insertFinding(pool, seed.orgA, staleId, clearCaseLawFinding(subject))

    const created = await createRun(version)
    expect(created.status).toBe(201)
    expect(created.body.run.id).not.toBe(staleId)
    expect(created.body.run.status).toBe('failed')
    expect(created.body.run.failureCode).toBe('model_unavailable')

    const stale = await runRow(staleId)
    expect(stale?.status).toBe('failed')
    expect(stale?.failure_code).toBe('interrupted')
    expect(stale?.lease_token).toBeNull()
    expect(stale?.completed_at).not.toBeNull()
    const staleFindings = await pool.query(
      `select 1 from verification_findings where run_id = $1`,
      [staleId],
    )
    expect(staleFindings.rows).toHaveLength(0)
    const audit = await pool.query<{
      action: string
      metadata_json: { failureCode: string | null }
    }>(`select action, metadata_json from audit_logs where entity_id = $1`, [
      staleId,
    ])
    const interrupt = audit.rows.find(
      (row) => row.metadata_json.failureCode === 'interrupted',
    )
    expect(interrupt?.action).toBe('verification.run_fail')
  })

  it('lets simultaneous posts settle on one replacement', async () => {
    const version = `ver_rec_${seed.suffix}_race`
    await insertReadyVersion(pool, seed, version, 22)
    extraVersions.push(version)
    const staleId = `vrun_${seed.suffix}_race`
    await insertRunningRun({
      id: staleId,
      versionId: version,
      leaseSecondsFromNow: -60,
      leaseToken: 'dead-race',
    })
    const gate = deferred()
    const blockedStorage = {
      ...throwingStorage(),
      readText: async () => {
        await gate.promise
        throw new Error('blocked storage released')
      },
    }
    const first = createRun(version, blockedStorage)
    // Wait until the first request has reclaimed and created the replacement.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const live = await pool.query<{ id: string }>(
        `select id from verification_runs
         where document_version_id = $1 and status = 'running'`,
        [version],
      )
      if (live.rows.length === 1 && live.rows[0]?.id !== staleId) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const second = await createRun(version)
    gate.resolve()
    const settled = await first
    expect(second.body.run.id).toBe(settled.body.run.id)
    const live = await pool.query<{ id: string }>(
      `select id from verification_runs
       where document_version_id = $1 and status in ('queued', 'running')`,
      [version],
    )
    expect(live.rows).toHaveLength(0)
    const rows = await pool.query<{ count: string }>(
      `select count(*)::text as count from verification_runs
       where document_version_id = $1`,
      [version],
    )
    expect(rows.rows[0]?.count).toBe('2')
  })

  it('refuses a stale completion over a reclaimed run', async () => {
    const version = `ver_rec_${seed.suffix}_complete`
    await insertReadyVersion(pool, seed, version, 23)
    extraVersions.push(version)
    const staleId = `vrun_${seed.suffix}_complete`
    await insertRunningRun({
      id: staleId,
      versionId: version,
      leaseSecondsFromNow: -60,
      leaseToken: 'stale-complete',
    })
    const created = await createRun(version)
    expect(created.body.run.id).not.toBe(staleId)
    const client = await pool.connect()
    try {
      const updated = await completeVerificationRun(client, {
        organisationId: seed.orgA,
        runId: staleId,
        status: 'completed',
        failureCode: null,
        leaseToken: 'stale-complete',
      })
      expect(updated).toBe(false)
    } finally {
      client.release()
    }
    const stale = await runRow(staleId)
    expect(stale?.status).toBe('failed')
    expect(stale?.failure_code).toBe('interrupted')
  })

  it('reuses the replacement on retry and never wedges the version', async () => {
    const version = `ver_rec_${seed.suffix}_retry`
    await insertReadyVersion(pool, seed, version, 24)
    extraVersions.push(version)
    const staleId = `vrun_${seed.suffix}_retry`
    await insertRunningRun({
      id: staleId,
      versionId: version,
      leaseSecondsFromNow: -60,
      leaseToken: 'dead-retry',
    })
    const first = await createRun(version)
    const retry = await createRun(version)
    // The first replacement has already terminated (failed), so the retry is a
    // fresh run rather than the dead one; neither is the wedged row.
    expect(first.body.run.id).not.toBe(staleId)
    expect(retry.body.run.id).not.toBe(staleId)
    const live = await pool.query<{ id: string }>(
      `select id from verification_runs
       where document_version_id = $1 and status in ('queued', 'running')`,
      [version],
    )
    expect(live.rows).toHaveLength(0)
    const stale = await runRow(staleId)
    expect(stale?.status).toBe('failed')
  })

  it('paginates runs on identical timestamps without duplicates or gaps', async () => {
    const version = `ver_rec_${seed.suffix}_page`
    await insertReadyVersion(pool, seed, version, 25)
    extraVersions.push(version)
    const createdAt = '2026-01-01T00:00:00.000Z'
    const ids = ['a', 'b', 'c', 'd', 'e'].map(
      (suffix) => `vrun_${seed.suffix}_page_${suffix}`,
    )
    for (const id of ids) {
      await pool.query(
        `insert into verification_runs (
           id, organisation_id, matter_id, document_id, document_version_id,
           status, failure_code, created_by, created_at, started_at, completed_at
         ) values ($1, $2, $3, $4, $5, 'failed', 'execution_failed', $6, $7::timestamptz, $7::timestamptz, $7::timestamptz)`,
        [
          id,
          seed.orgA,
          seed.matterA,
          seed.documentA,
          version,
          seed.userA,
          createdAt,
        ],
      )
    }
    const userA = app(pool, seed.userA, seed.orgA)
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 50; page += 1) {
      const query = cursor
        ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '?limit=2'
      const response = await userA.request(
        `/api/documents/${seed.documentA}/verification-runs${query}`,
      )
      const body = verificationRunListResponseSchema.parse(
        await response.json(),
      )
      seen.push(...body.runs.map((run) => run.id))
      cursor = body.nextCursor
      if (!cursor) break
    }
    expect(new Set(seen).size).toBe(seen.length)
    // All five page rows share one timestamp, so they must still come back in
    // the id-desc tiebreaker order with no gap or repeat.
    const pageIds = seen.filter((id) => ids.includes(id))
    expect(pageIds).toEqual([...ids].reverse())
  })

  it('rejects malformed cursors and out-of-range limits safely', async () => {
    const userA = app(pool, seed.userA, seed.orgA)
    const badCursor = await userA.request(
      '/api/verification-runs?cursor=not-a-cursor',
    )
    expect(badCursor.status).toBe(400)
    for (const limit of ['0', '-1', '1000', 'abc']) {
      const response = await userA.request(
        `/api/verification-runs?limit=${limit}`,
      )
      expect(response.status).toBe(400)
    }
  })

  it('bounds a run findings page', async () => {
    const version = `ver_rec_${seed.suffix}_findings`
    await insertReadyVersion(pool, seed, version, 26)
    extraVersions.push(version)
    const runId = `vrun_${seed.suffix}_findings`
    await pool.query(
      `insert into verification_runs (
         id, organisation_id, matter_id, document_id, document_version_id,
         status, failure_code, created_by, created_at, started_at, completed_at
       ) values ($1, $2, $3, $4, $5, 'completed', null, $6, now(), now(), now())`,
      [runId, seed.orgA, seed.matterA, seed.documentA, version, seed.userA],
    )
    const subject: Subject = { documentId: seed.documentA, versionId: version }
    const base = clearCaseLawFinding(subject)
    for (let index = 0; index < 3; index += 1) {
      const location = {
        paragraphId: 'p1',
        start: index * 14,
        end: index * 14 + 13,
      }
      await insertFinding(pool, seed.orgA, runId, {
        ...base,
        id: createVerificationFindingId({
          subject,
          type: 'authority_existence',
          location,
        }),
        citation: { rawText: '[2024] UKSC 1', location },
      })
    }
    const userA = app(pool, seed.userA, seed.orgA)
    const first = verificationFindingsResponseSchema.parse(
      await (
        await userA.request(`/api/verification-runs/${runId}/findings?limit=2`)
      ).json(),
    )
    expect(first.findings).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = verificationFindingsResponseSchema.parse(
      await (
        await userA.request(
          `/api/verification-runs/${runId}/findings?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
        )
      ).json(),
    )
    expect(second.findings).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    const ids = [...first.findings, ...second.findings].map(
      (finding) => finding.id,
    )
    expect(new Set(ids).size).toBe(3)
  })
})
