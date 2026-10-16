import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../database'
import { createTestPool } from '../test-database.test-support'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import {
  cleanupMatter,
  editorUser,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

/**
 * E12 handoff, exercised end to end: a finalized document-bound run returns
 * its burned DOCX artifact to the source document as a new immutable
 * version. Every case below runs the real route against a real database so
 * the locking, ACL and provenance ordering is the production path, not a
 * mock of it.
 */
const pool = createTestPool()
const outputBytes = await readFile('../../data/evals/redact/demo-fixture.docx')
const outputSha256 = createHash('sha256').update(outputBytes).digest('hex')
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Seed = Awaited<ReturnType<typeof seedMatter>>

type ReturnBody = {
  status: 'returned' | 'already_returned'
  documentId: string
  versionId: string
  versionNumber: number
}

interface ReturnSeed extends Seed {
  runId: string
  artifactId: string
  artifactKey: string
}

async function seedFinalizedRun(
  access: 'edit' | 'view' | null,
  overrides: { status?: string; sha256?: string } = {},
): Promise<ReturnSeed> {
  const seed = await seedMatter(pool, access)
  const runId = `red_return_${seed.documentId}`
  const artifactId = `art_return_${seed.documentId}`
  const artifactKey = `org/${seed.orgId}/matters/${seed.matterId}/artifacts/${artifactId}`
  await pool.query(
    `insert into artifacts (
       id, organisation_id, matter_id, document_id, document_version_id,
       artifact_type, status, object_key, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'redaction_output', 'ready', $6, $7,
       now(), now())`,
    [
      artifactId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      seed.versionId,
      artifactKey,
      seed.ownerId,
    ],
  )
  await pool.query(
    `insert into redaction_runs (
       id, organisation_id, matter_id, document_id, document_version_id,
       source_filename, status, policy_mode, spans_json, decisions_json,
       output_artifact_id, summary_json, detection_mode, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'synthetic.docx', $6,
       'internal_ai_minimisation', '[]'::jsonb, '{}'::jsonb, $7, $8::jsonb,
       'heuristics+supplement', $9, now(), now())`,
    [
      runId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      seed.versionId,
      overrides.status ?? 'finalized',
      artifactId,
      JSON.stringify({
        outputMimeType: DOCX_MIME,
        outputSha256: overrides.sha256 ?? outputSha256,
      }),
      seed.ownerId,
    ],
  )
  return { ...seed, runId, artifactId, artifactKey }
}

/** Move the document head forward, leaving the run's source historical. */
async function supersedeSource(seed: ReturnSeed) {
  const versionId = `${seed.versionId}_v2`
  await pool.query(
    `insert into document_versions (
       id, organisation_id, matter_id, matter_document_id, filename,
       file_type, size_bytes, object_key, text_object_key, document_status,
       failure_reason, version_number, content_sha256, sync_state, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, 'synthetic.docx', 'docx', 10, $5, null,
       'ready', null, 2, $6, 'synced', $7, now(), now())`,
    [
      versionId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      createDocumentObjectKey({
        organisationId: seed.orgId,
        matterId: seed.matterId,
        documentId: seed.documentId,
        versionId,
      }),
      createHash('sha256').update('v2').digest('hex'),
      seed.ownerId,
    ],
  )
  await pool.query(
    `update matter_documents set current_version_id = $1 where id = $2`,
    [versionId, seed.documentId],
  )
  return versionId
}

function returnApp(storage: unknown, user: AuthzUser) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_return')
    c.set('user', user)
    await next()
  })
  routes.route(
    '/',
    createRedactLifecycleRoutes(
      pool,
      storage as Parameters<typeof createRedactLifecycleRoutes>[1],
    ),
  )
  return routes
}

function returnRequest(seed: ReturnSeed, baseVersionId = seed.versionId) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersionId }),
  }
}

async function versionCount(seed: ReturnSeed) {
  const rows = await pool.query(
    `select id from document_versions where matter_document_id = $1`,
    [seed.documentId],
  )
  return rows.rows.length
}

async function returnedVersionId(seed: ReturnSeed) {
  const rows = await pool.query<{
    returned_document_version_id: string | null
  }>(`select returned_document_version_id from redaction_runs where id = $1`, [
    seed.runId,
  ])
  return rows.rows[0]?.returned_document_version_id ?? null
}

async function cleanupRun(seed: ReturnSeed) {
  await pool.query(`delete from redaction_runs where organisation_id = $1`, [
    seed.orgId,
  ])
  await pool.query(`delete from artifacts where organisation_id = $1`, [
    seed.orgId,
  ])
  await cleanupMatter(pool, seed)
}

describe('POST /api/redaction-runs/:runId/return-to-document', () => {
  it('commits the finalized output as a linked immutable version', async () => {
    const seed = await seedFinalizedRun('edit')
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )

      expect(response.status).toBe(201)
      const body = (await response.json()) as ReturnBody
      expect(body.status).toBe('returned')
      expect(body.documentId).toBe(seed.documentId)
      expect(body.versionNumber).toBe(2)

      // The document head moved to the returned version, which carries the
      // artifact bytes byte-for-byte.
      const head = await pool.query<{ current_version_id: string }>(
        `select current_version_id from matter_documents where id = $1`,
        [seed.documentId],
      )
      expect(head.rows[0]?.current_version_id).toBe(body.versionId)
      expect(await returnedVersionId(seed)).toBe(body.versionId)
      const written = storage.binary.get(
        createDocumentObjectKey({
          organisationId: seed.orgId,
          matterId: seed.matterId,
          documentId: seed.documentId,
          versionId: body.versionId,
        }),
      )
      expect(written?.equals(outputBytes)).toBe(true)

      const audit = await pool.query<{
        action: string
        metadata_json: unknown
      }>(
        `select action, metadata_json from audit_logs
         where organisation_id = $1 and action = 'redaction.return_to_document'`,
        [seed.orgId],
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]?.metadata_json).toMatchObject({
        runId: seed.runId,
        artifactId: seed.artifactId,
        sourceVersionId: seed.versionId,
        returnedVersionId: body.versionId,
      })
    } finally {
      await cleanupRun(seed)
    }
  })

  it('replays an already-returned run without minting a second version', async () => {
    const seed = await seedFinalizedRun('edit')
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const first = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(first.status).toBe(201)
      const firstBody = (await first.json()) as ReturnBody

      const second = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(second.status).toBe(200)
      await expect(second.json()).resolves.toEqual({
        status: 'already_returned',
        documentId: seed.documentId,
        versionId: firstBody.versionId,
        versionNumber: 2,
      })
      expect(await versionCount(seed)).toBe(2)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('refuses a stale head: the output would discard intervening edits', async () => {
    const seed = await seedFinalizedRun('edit')
    try {
      await supersedeSource(seed)
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'conflict_detected' },
      })
      expect(await versionCount(seed)).toBe(2)
      expect(await returnedVersionId(seed)).toBeNull()
    } finally {
      await cleanupRun(seed)
    }
  })

  it('refuses a base version that is not the run source', async () => {
    const seed = await seedFinalizedRun('edit')
    try {
      const other = await supersedeSource(seed)
      // The head moved and the caller still names it: the run's source is
      // historical now, so even a current base cannot carry this output.
      await pool.query(
        `update matter_documents set current_version_id = $1 where id = $2`,
        [seed.versionId, seed.documentId],
      )
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed, other),
      )
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'conflict_detected' },
      })
    } finally {
      await cleanupRun(seed)
    }
  })

  it('returns 422 for an unfinalized run and records nothing', async () => {
    const seed = await seedFinalizedRun('edit', { status: 'ready_for_review' })
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'redaction_return_unavailable' },
      })
      expect(await versionCount(seed)).toBe(1)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('refuses an artifact whose bytes no longer match the recorded sha', async () => {
    const seed = await seedFinalizedRun('edit', {
      sha256: 'f'.repeat(64),
    })
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(response.status).toBe(422)
      expect(await versionCount(seed)).toBe(1)
      expect(await returnedVersionId(seed)).toBeNull()
    } finally {
      await cleanupRun(seed)
    }
  })

  it('denies a view-only grantee and a cross-organisation stranger', async () => {
    const seed = await seedFinalizedRun('view')
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)

      const viewer = returnApp(storage, editorUser(seed))
      const denied = await viewer.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(denied.status).toBe(404)
      await expect(denied.json()).resolves.toMatchObject({
        error: { code: 'redaction_run_not_found' },
      })

      const stranger = returnApp(storage, {
        id: seed.strangerId,
        organisationId: seed.otherOrgId,
        role: 'member',
      })
      const foreign = await stranger.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(foreign.status).toBe(404)
      // Neither attempt created a version.
      expect(await versionCount(seed)).toBe(1)

      const owner = returnApp(storage, ownerUser(seed))
      const allowed = await owner.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(allowed.status).toBe(201)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('returns 404 for a deleted run', async () => {
    const seed = await seedFinalizedRun('edit')
    try {
      await pool.query(
        `update redaction_runs set deleted_at = now(), deleted_by = $2
         where id = $1`,
        [seed.runId, seed.ownerId],
      )
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, ownerUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        returnRequest(seed),
      )
      expect(response.status).toBe(404)
      expect(await versionCount(seed)).toBe(1)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('rejects a request without a base version', async () => {
    const seed = await seedFinalizedRun('edit')
    try {
      const storage = storageFor(seed)
      storage.binary.set(seed.artifactKey, outputBytes)
      const app = returnApp(storage, editorUser(seed))
      const response = await app.request(
        `/api/redaction-runs/${seed.runId}/return-to-document`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'validation_failed' },
      })
    } finally {
      await cleanupRun(seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
