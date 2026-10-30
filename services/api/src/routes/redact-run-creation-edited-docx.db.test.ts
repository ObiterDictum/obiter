import { createHash } from 'node:crypto'
import { afterAll, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { createSyntheticDocx } from '@obiter/ooxml'
import type { AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../document-database'
import type { StorageService } from '../storage'
import { createTestPool } from '../test-database.test-support'
import {
  cleanupMatter,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

mock.module('../redaction-detection', () => ({
  detectionMode: () => 'model+supplement',
  detectRedactionSpans: async (text: string) => ({
    spans: [...text.matchAll(/\bSTATE\b/gu)].map((match, index) => ({
      id: `s${index}`,
      start: match.index,
      end: match.index + 5,
      text: 'STATE',
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    })),
    detectorVersion: 'synthetic',
    degraded: false,
  }),
}))
const { createRedactRunCreationRoutes } = await import('./redact-run-creation')
const { createRedactReviewRoutes } = await import('./redact-review')
const pool = createTestPool()
afterAll(() => pool.end())

const json = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function appFor(
  seed: Awaited<ReturnType<typeof seedMatter>>,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_edited_docx')
    c.set('user', ownerUser(seed))
    await next()
  })
  routes.route('/', createRedactRunCreationRoutes(pool, storage))
  routes.route('/', createRedactReviewRoutes(pool, storage))
  return routes
}

it('starts a redaction run from an edited DOCX version whose stored text key is null', async () => {
  const seed = await seedMatter(pool, null)
  try {
    const storage = storageFor(seed)
    const editedText =
      'STATEMENT OF THE CLAIMANT: STATE. A paragraph added after the save.'
    storage.binary.set(
      seed.sourceKey,
      Buffer.from(await createSyntheticDocx([editedText])),
    )
    const app = appFor(seed, storage)

    const created = await app.request(
      `/api/documents/${seed.documentId}/redaction-runs`,
      json({}),
    )

    expect(created.status).toBe(201)
    const { run } = (await created.json()) as {
      run: { id: string; spans: Array<{ text: string }> }
    }
    expect(run.spans.map((span) => span.text)).toEqual(['STATE'])
    const sourceKey = `org/${seed.orgId}/redaction-runs/${run.id}/source`
    expect(storage.text.get(sourceKey)).toBe(editedText)

    const read = await app.request(
      `/api/redaction-runs/${run.id}/document-text`,
    )
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toEqual({ text: editedText })

    const version = await pool.query<{ text_object_key: string | null }>(
      'select text_object_key from document_versions where id = $1',
      [seed.versionId],
    )
    expect(version.rows[0]?.text_object_key).toBeNull()
  } finally {
    await pool.query('delete from redaction_runs where organisation_id = $1', [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
})

it('refuses a non-DOCX version with no stored text', async () => {
  const seed = await seedMatter(pool, null)
  try {
    const versionId = `${seed.versionId}_txt`
    const objectKey = createDocumentObjectKey({
      organisationId: seed.orgId,
      matterId: seed.matterId,
      documentId: seed.documentId,
      versionId,
    })
    await pool.query(
      `insert into document_versions (
         id, organisation_id, matter_id, matter_document_id, filename,
         file_type, size_bytes, object_key, text_object_key, document_status,
         failure_reason, version_number, content_sha256, sync_state, created_by,
         created_at, updated_at
       ) values ($1, $2, $3, $4, 'notes.txt', 'txt', 4, $5, null, 'ready',
         null, 2, $6, 'synced', $7, now(), now())`,
      [
        versionId,
        seed.orgId,
        seed.matterId,
        seed.documentId,
        objectKey,
        createHash('sha256').update('text').digest('hex'),
        seed.ownerId,
      ],
    )
    await pool.query(
      'update matter_documents set current_version_id = $1 where id = $2',
      [versionId, seed.documentId],
    )
    const app = appFor(seed, storageFor(seed))

    const response = await app.request(
      `/api/documents/${seed.documentId}/redaction-runs`,
      json({}),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'document_version_not_found' },
    })
  } finally {
    await pool.query('delete from redaction_runs where organisation_id = $1', [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
})
