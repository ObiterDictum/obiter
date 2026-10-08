import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../database'
import { createTestPool } from '../test-database.test-support'
import { createRedactReviewRoutes } from './redact-review'
import {
  cleanupMatter,
  editorUser,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

/**
 * A redaction run bound to a document version resolves its source text,
 * source file and layout through `document_versions`. While the bound
 * version is the document's current one, run-level 'view' already covers
 * that content; once a newer version supersedes it the bytes are historical
 * document content and the same matter-level 'edit' gate as `?versionId=`
 * applies. A denied read returns the run's ordinary 'source not available'
 * 404 and never reaches storage. Every case below runs the real routes
 * against a real database.
 */

const pool = createTestPool()

type Seed = Awaited<ReturnType<typeof seedMatter>>

interface RunSeed extends Seed {
  runId: string
  textKey: string
  layoutKey: string
}

/** A ready run bound to the seeded version; the version gets a text object. */
async function seedBoundRun(access: 'edit' | 'view' | null): Promise<RunSeed> {
  const seed = await seedMatter(pool, access)
  const runId = `red_${seed.documentId}`
  const textKey = seed.sourceKey.replace(/\/source$/, '/text')
  const layoutKey = seed.sourceKey.replace(/\/source$/, '/layout.json')
  await pool.query(
    `update document_versions set text_object_key = $1 where id = $2`,
    [textKey, seed.versionId],
  )
  await pool.query(
    `insert into redaction_runs (
       id, organisation_id, matter_id, document_id, document_version_id,
       source_filename, status, policy_mode, spans_json, decisions_json,
       summary_json, detection_mode, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'synthetic.docx', 'ready_for_review',
       'internal_ai_minimisation', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
       'heuristics+supplement', $6, now(), now())`,
    [
      runId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      seed.versionId,
      seed.ownerId,
    ],
  )
  return { ...seed, runId, textKey, layoutKey }
}

/** Promote a fresh v2 to current, leaving the run's bound version historical. */
async function supersedeBoundVersion(seed: RunSeed) {
  const currentVersionId = `${seed.versionId}_v2`
  const currentSourceKey = createDocumentObjectKey({
    organisationId: seed.orgId,
    matterId: seed.matterId,
    documentId: seed.documentId,
    versionId: currentVersionId,
  })
  await pool.query(
    `insert into document_versions (
       id, organisation_id, matter_id, matter_document_id, filename,
       file_type, size_bytes, object_key, text_object_key, document_status,
       failure_reason, version_number, content_sha256, sync_state, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, 'synthetic.docx', 'docx', 10, $5, null,
       'ready', null, 2, $6, 'synced', $7, now(), now())`,
    [
      currentVersionId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      currentSourceKey,
      createHash('sha256').update('v2').digest('hex'),
      seed.ownerId,
    ],
  )
  await pool.query(
    `update matter_documents set current_version_id = $1 where id = $2`,
    [currentVersionId, seed.documentId],
  )
}

function storageForRun(seed: RunSeed) {
  const storage = storageFor(seed)
  storage.text.set(seed.textKey, 'Version one source text.')
  storage.text.set(
    seed.layoutKey,
    JSON.stringify({
      version: 2,
      pages: [{ width: 200, height: 200 }],
      segments: [],
    }),
  )
  return storage
}

function runApp(pool: Pool, storage: unknown, user: AuthzUser) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_run_acl')
    c.set('user', user)
    await next()
  })
  routes.route(
    '/',
    createRedactReviewRoutes(
      pool,
      storage as Parameters<typeof createRedactReviewRoutes>[1],
    ),
  )
  return routes
}

function sourcePaths(seed: RunSeed) {
  return [
    `/api/redaction-runs/${seed.runId}/document-text`,
    `/api/redaction-runs/${seed.runId}/source-file`,
    `/api/redaction-runs/${seed.runId}/layout`,
  ]
}

async function cleanupRun(seed: RunSeed) {
  await pool.query(`delete from redaction_runs where organisation_id = $1`, [
    seed.orgId,
  ])
  await cleanupMatter(pool, seed)
}

describe('run-bound source historical gate', () => {
  it('serves a view grantee the source while the bound version is current', async () => {
    const seed = await seedBoundRun('view')
    try {
      const storage = storageForRun(seed)
      const viewer = runApp(pool, storage, editorUser(seed))
      for (const path of sourcePaths(seed)) {
        const response = await viewer.request(path)
        expect(response.status).toBe(200)
      }
      const text = await viewer.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      await expect(text.json()).resolves.toEqual({
        text: 'Version one source text.',
      })
    } finally {
      await cleanupRun(seed)
    }
  })

  it('denies a view grantee every source route once the bound version is historical', async () => {
    const seed = await seedBoundRun('view')
    try {
      await supersedeBoundVersion(seed)
      const storage = storageForRun(seed)
      const viewer = runApp(pool, storage, editorUser(seed))
      for (const path of sourcePaths(seed)) {
        const response = await viewer.request(path)
        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toMatchObject({
          error: { code: 'document_version_not_found' },
        })
      }
      // The gate fires inside the key lookup: a denied request never reaches
      // stored bytes for the historical version.
      expect(storage.binaryReads).toEqual([])
      expect(storage.textReads).toEqual([])

      // Concealment parity: the denied body is identical to the one for a
      // run whose bound version simply has no text object.
      const denied = await viewer.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      const missingVersionId = `${seed.versionId}_v2`
      await pool.query(
        `insert into redaction_runs (
           id, organisation_id, matter_id, document_id, document_version_id,
           source_filename, status, policy_mode, detection_mode, created_by,
           created_at, updated_at
         ) values ($1, $2, $3, $4, $5, 'synthetic.docx', 'ready_for_review',
           'internal_ai_minimisation', 'heuristics+supplement', $6,
           now(), now())`,
        [
          `red_missing_${seed.documentId}`,
          seed.orgId,
          seed.matterId,
          seed.documentId,
          missingVersionId,
          seed.ownerId,
        ],
      )
      const missing = await viewer.request(
        `/api/redaction-runs/red_missing_${seed.documentId}/document-text`,
      )
      expect(missing.status).toBe(404)
      await expect(denied.json()).resolves.toEqual(await missing.json())
    } finally {
      await cleanupRun(seed)
    }
  })

  it('serves an edit grantee the historical source on every route', async () => {
    const seed = await seedBoundRun('edit')
    try {
      await supersedeBoundVersion(seed)
      const storage = storageForRun(seed)
      const editor = runApp(pool, storage, editorUser(seed))
      const text = await editor.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      expect(text.status).toBe(200)
      await expect(text.json()).resolves.toEqual({
        text: 'Version one source text.',
      })
      const source = await editor.request(
        `/api/redaction-runs/${seed.runId}/source-file`,
      )
      expect(source.status).toBe(200)
      expect(storage.binaryReads).toEqual([seed.sourceKey])
      const layout = await editor.request(
        `/api/redaction-runs/${seed.runId}/layout`,
      )
      expect(layout.status).toBe(200)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('keeps the gate live across a share upgrade on a historical version', async () => {
    const seed = await seedBoundRun('view')
    try {
      await supersedeBoundVersion(seed)
      const storage = storageForRun(seed)
      const grantee = runApp(pool, storage, editorUser(seed))
      const denied = await grantee.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      expect(denied.status).toBe(404)
      // Upgrading the same grantee to 'edit' reopens the historical source:
      // the decision reads the share at request time, not at run creation.
      await pool.query(
        `update matter_shares set access_level = 'edit' where id = $1`,
        [seed.shareId],
      )
      const allowed = await grantee.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      expect(allowed.status).toBe(200)
    } finally {
      await cleanupRun(seed)
    }
  })

  it('denies a cross-organisation stranger while the owner still reads', async () => {
    const seed = await seedBoundRun('view')
    try {
      await supersedeBoundVersion(seed)
      const storage = storageForRun(seed)
      const stranger = runApp(pool, storage, {
        id: seed.strangerId,
        organisationId: seed.otherOrgId,
        role: 'member',
      })
      const response = await stranger.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'redaction_run_not_found' },
      })
      expect(storage.textReads).toEqual([])

      const owner = runApp(pool, storage, ownerUser(seed))
      const ownerText = await owner.request(
        `/api/redaction-runs/${seed.runId}/document-text`,
      )
      expect(ownerText.status).toBe(200)
    } finally {
      await cleanupRun(seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
