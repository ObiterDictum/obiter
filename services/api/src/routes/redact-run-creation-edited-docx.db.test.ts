import { createHash } from 'node:crypto'
import { afterAll, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'
import { createSyntheticDocx } from '@obiter/ooxml'
import type { AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../document-database'
import { MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH } from '../document-extraction-limits'
import type { StorageService } from '../storage'
import {
  claimDetectionJob,
  processDetectionJob,
} from '../redaction-detection-jobs'
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

async function finish(created: Response, storage: StorageService) {
  expect(created.status).toBe(202)
  const body = z
    .object({ run: z.object({ id: z.string(), status: z.string() }) })
    .parse(await created.json())
  expect(body.run.status).toBe('detecting')
  const job = await claimDetectionJob(pool)
  if (!job) throw new Error('Expected queued job')
  expect(job.id).toBe(body.run.id)
  await processDetectionJob(pool, storage, job)
  const result = await pool.query<{
    id: string
    spans_json: Array<{ text: string }>
    status: string
    summary_json: { failureReason: string }
  }>(
    'select id, spans_json, status, summary_json from redaction_runs where id = $1',
    [job.id],
  )
  const row = result.rows[0]
  return {
    id: row.id,
    spans: row.spans_json,
    status: row.status,
    summary: row.summary_json,
  }
}

const VARIED_WORDS = [
  'covenant',
  'easement',
  'leasehold',
  'indemnity',
  'schedule',
  'undertaking',
  'conveyance',
  'dilapidations',
  'forfeiture',
  'assignment',
  'premium',
  'arrears',
  'surveyor',
  'correspondence',
  'privilege',
  'annexure',
  'executed',
  'witnessed',
  'solicitor',
  'counsel',
  'retainer',
  'disclosure',
  'freehold',
  'registered',
  'occupation',
  'encroachment',
  'restriction',
  'transferor',
  'transferee',
  'lessor',
  'lessee',
  'determination',
  'remedy',
  'injunction',
  'nuisance',
  'trespass',
  'negligence',
  'estoppel',
  'probate',
  'intestacy',
  'residue',
  'consideration',
  'apportionment',
  'retention',
  'disbursement',
  'termination',
  'renewal',
  'deposit',
  'guarantee',
]

function variedText(length: number) {
  let text = ''
  let state = 0x9e3779b9
  while (text.length < length) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    text += `${VARIED_WORDS[state % VARIED_WORDS.length]} `
  }
  return text.slice(0, length)
}

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

    const run = await finish(created, storage)
    expect(run.status).toBe('ready_for_review')
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

it('starts a redaction run for a document longer than the old 200,000-character refusal', async () => {
  const seed = await seedMatter(pool, null)
  try {
    const storage = storageFor(seed)
    const longText = `STATE ${variedText(300_000)}`
    storage.binary.set(
      seed.sourceKey,
      Buffer.from(await createSyntheticDocx([longText])),
    )
    const app = appFor(seed, storage)

    const created = await app.request(
      `/api/documents/${seed.documentId}/redaction-runs`,
      json({}),
    )

    expect(longText.length).toBeGreaterThan(200_000)
    const run = await finish(created, storage)
    expect(run.status).toBe('ready_for_review')
    expect(run.spans.map((span) => span.text)).toEqual(['STATE'])
  } finally {
    await pool.query('delete from redaction_runs where organisation_id = $1', [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
})

it('fails over-limit extraction in the job with a safe specific reason', async () => {
  const seed = await seedMatter(pool, null)
  try {
    const storage = storageFor(seed)
    const tooLong = variedText(MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH + 1)
    storage.binary.set(
      seed.sourceKey,
      Buffer.from(await createSyntheticDocx([tooLong])),
    )
    const app = appFor(seed, storage)

    const response = await app.request(
      `/api/documents/${seed.documentId}/redaction-runs`,
      json({}),
    )

    const run = await finish(response, storage)
    expect(run.status).toBe('failed')
    expect(run.summary.failureReason).toContain('2,000,000')
  } finally {
    await pool.query('delete from redaction_runs where organisation_id = $1', [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
})

it('extracts a non-DOCX version from its original when no stored text exists', async () => {
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
    const storage = storageFor(seed)
    storage.binary.set(objectKey, Buffer.from('STATE'))
    const app = appFor(seed, storage)

    const response = await app.request(
      `/api/documents/${seed.documentId}/redaction-runs`,
      json({}),
    )

    const run = await finish(response, storage)
    expect(run.status).toBe('ready_for_review')
    expect(run.spans.map((span) => span.text)).toEqual(['STATE'])
  } finally {
    await pool.query('delete from redaction_runs where organisation_id = $1', [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
})
