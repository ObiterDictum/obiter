import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import JSZip from 'jszip'
import type { Pool } from 'pg'
import { expect } from 'bun:test'
import { parseDocx } from '@obiter/ooxml'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../database'
import { deriveDocumentSiblingObjectKey } from '../document-artifact-store'
import { EditStorage } from './document-edit.test-support'
import { createCommentsRoutes } from './comments'
import { createDocumentAccessRoutes } from './document-access'
import { createDocumentCollaborationRoutes } from './document-collaboration'
import { createDocumentEditRoutes } from './document-edit'
import { createTrackedChangeRoutes } from './tracked-changes'

/**
 * P0.13: share revocation must not race an already-authorised document or
 * comment write into committing afterwards.
 *
 * Each path below runs the real route against a real database. The writer is
 * paused by a promise gate placed immediately after its route-level access
 * query, so the ordering "early check passed, revocation commits, writer
 * resumes" is exact and needs no sleeps. A write that wins the lock instead
 * commits first and revocation follows.
 */

const plainSourceBytes = await readFile(
  '../../data/evals/redact/demo-fixture.docx',
)
const trackedSourceBytes = await addTrackedChanges(plainSourceBytes)
const plainModel = (await parseDocx(plainSourceBytes)).model
const trackedModel = (await parseDocx(trackedSourceBytes)).model
const plainParagraph = plainModel.stories.find(
  ({ kind }) => kind === 'document',
)?.paragraphs[0]
export const editableRunId = plainParagraph?.runs[0]?.id
const insertionId = trackedModel.changes.find(
  ({ elementName }) => elementName === 'ins',
)?.id
if (!plainParagraph || !editableRunId || !insertionId) {
  throw new Error('Share-revocation race fixture is incomplete.')
}
const trackedModelJson = JSON.stringify(trackedModel)
const trackedBytesSha256 = createHash('sha256')
  .update(trackedSourceBytes)
  .digest('hex')
const anchor = {
  paragraphId: plainParagraph.id,
  startOffset: 0,
  endOffset: 1,
}

interface Seed {
  orgId: string
  ownerId: string
  editorId: string
  otherOrgId: string
  strangerId: string
  matterId: string
  documentId: string
  versionId: string
  shareId: string
  commentId: string
  sourceKey: string
  modelKey: string
}

async function addTrackedChanges(source: Uint8Array) {
  const zip = await JSZip.loadAsync(source)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Test document story is missing.')
  const xml = await entry.async('string')
  const changes =
    '<w:ins w:id="10" w:author="Foreign Reviewer" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Inserted review text</w:t></w:r></w:ins><w:del w:id="11" w:author="Foreign Reviewer" w:date="2026-08-10T10:01:00Z"><w:r><w:delText>Deleted review text</w:delText></w:r></w:del><w:moveFrom w:id="12"><w:r><w:delText>Moved from</w:delText></w:r></w:moveFrom><w:moveTo w:id="12"><w:r><w:t>Moved to</w:t></w:r></w:moveTo><w:pPr><w:pPrChange w:id="13"><w:pPr/></w:pPrChange></w:pPr><w:r><w:rPr><w:rPrChange w:id="14"><w:rPr/></w:rPrChange></w:rPr><w:t>Property review</w:t></w:r>'
  zip.file(
    'word/document.xml',
    xml.replace(/(<w:p(?:\s[^>]*)?>)/u, `$1${changes}`),
  )
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

export async function seedMatter(
  pool: Pool,
  access: 'edit' | 'view' | null,
): Promise<Seed> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const seed: Seed = {
    orgId: `org_race_${suffix}`,
    ownerId: `usr_race_${suffix}_owner`,
    editorId: `usr_race_${suffix}_editor`,
    otherOrgId: `org_race_${suffix}_other`,
    strangerId: `usr_race_${suffix}_stranger`,
    matterId: `mtr_race_${suffix}`,
    documentId: `doc_race_${suffix}`,
    versionId: `ver_race_${suffix}`,
    shareId: `shr_race_${suffix}`,
    commentId: `cmt_race_${suffix}`,
    sourceKey: '',
    modelKey: '',
  }
  seed.sourceKey = createDocumentObjectKey({
    organisationId: seed.orgId,
    matterId: seed.matterId,
    documentId: seed.documentId,
    versionId: seed.versionId,
  })
  seed.modelKey = deriveDocumentSiblingObjectKey(seed.sourceKey, 'model.json')

  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now()), ($3, $4, now(), now())`,
    [seed.orgId, `Race org ${suffix}`, seed.otherOrgId, `Other ${suffix}`],
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
      'Race Owner',
      `${seed.ownerId}@example.com`,
      seed.orgId,
      seed.editorId,
      'Race Editor',
      `${seed.editorId}@example.com`,
      seed.strangerId,
      'Race Stranger',
      `${seed.strangerId}@example.com`,
      seed.otherOrgId,
    ],
  )
  await pool.query(
    `insert into matters (
       id, organisation_id, name, description, primary_jurisdiction,
       secondary_jurisdictions, legal_domains, client_reference,
       status, created_by, created_at, updated_at
     ) values ($1, $2, $3, null, 'england_and_wales', '[]'::jsonb,
       '[]'::jsonb, '', 'active', $4, now(), now())`,
    [seed.matterId, seed.orgId, `Race matter ${suffix}`, seed.ownerId],
  )
  await pool.query(
    `insert into matter_documents (
       id, organisation_id, matter_id, current_version_id, logical_key,
       created_by, created_at, updated_at
     ) values ($1, $2, $3, null, $4, $5, now(), now())`,
    [
      seed.documentId,
      seed.orgId,
      seed.matterId,
      `logical_${suffix}`,
      seed.ownerId,
    ],
  )
  await pool.query(
    `insert into document_versions (
       id, organisation_id, matter_id, matter_document_id, filename,
       file_type, size_bytes, object_key, text_object_key, document_status,
       failure_reason, version_number, content_sha256, sync_state, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, 'synthetic.docx', 'docx', $5, $6, null,
       'ready', null, 1, $7, 'synced', $8, now(), now())`,
    [
      seed.versionId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      trackedSourceBytes.byteLength,
      seed.sourceKey,
      trackedBytesSha256,
      seed.ownerId,
    ],
  )
  await pool.query(
    `update matter_documents set current_version_id = $1 where id = $2`,
    [seed.versionId, seed.documentId],
  )
  await pool.query(
    `insert into document_comments (
       id, organisation_id, matter_id, document_id, anchor_version_id,
       paragraph_id, start_offset, end_offset, body, author_id, author_name,
       resolved_at, resolved_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, 0, 1, 'Seeded comment', $7,
       'Race Owner', null, null, now(), now())`,
    [
      seed.commentId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      seed.versionId,
      anchor.paragraphId,
      seed.ownerId,
    ],
  )
  if (access !== null) {
    await pool.query(
      `insert into matter_shares (
         id, organisation_id, matter_id, grantee_user_id, access_level,
         created_by, created_at
       ) values ($1, $2, $3, $4, $5, $6, now())`,
      [
        seed.shareId,
        seed.orgId,
        seed.matterId,
        seed.editorId,
        access,
        seed.ownerId,
      ],
    )
  }
  return seed
}

export async function cleanupMatter(pool: Pool, seed: Seed) {
  for (const organisationId of [seed.orgId, seed.otherOrgId]) {
    await pool.query(`delete from audit_logs where organisation_id = $1`, [
      organisationId,
    ])
    await pool.query(
      `delete from document_comments where organisation_id = $1`,
      [organisationId],
    )
    await pool.query(
      `update matter_documents set current_version_id = null where organisation_id = $1`,
      [organisationId],
    )
    await pool.query(
      `delete from document_versions where organisation_id = $1`,
      [organisationId],
    )
    await pool.query(
      `delete from matter_documents where organisation_id = $1`,
      [organisationId],
    )
    await pool.query(`delete from matter_shares where organisation_id = $1`, [
      organisationId,
    ])
    await pool.query(`delete from matters where organisation_id = $1`, [
      organisationId,
    ])
    await pool.query(`delete from users where "organisationId" = $1`, [
      organisationId,
    ])
    await pool.query(`delete from organisations where id = $1`, [
      organisationId,
    ])
  }
}

export function storageFor(seed: Seed) {
  const storage = new EditStorage()
  storage.binary.set(seed.sourceKey, trackedSourceBytes)
  storage.text.set(seed.modelKey, trackedModelJson)
  return storage
}

export function ownerUser(seed: Seed): AuthzUser {
  return { id: seed.ownerId, organisationId: seed.orgId, role: 'owner' }
}

export function editorUser(seed: Seed): AuthzUser {
  return { id: seed.editorId, organisationId: seed.orgId, role: 'member' }
}

export function app(
  pool: Pool,
  storage: EditStorage,
  user: AuthzUser,
  requestId: string,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', requestId)
    c.set('user', user)
    await next()
  })
  routes.route('/', createDocumentEditRoutes(pool, storage))
  routes.route('/', createTrackedChangeRoutes(pool, storage))
  routes.route('/', createDocumentCollaborationRoutes(pool, storage))
  routes.route('/', createCommentsRoutes(pool, storage))
  return routes
}

export function shareApp(pool: Pool, user: AuthzUser, requestId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', requestId)
    c.set('user', user)
    await next()
  })
  routes.route('/', createDocumentAccessRoutes(pool))
  return routes
}

/**
 * Replaces the pool handed to the routes with one that resolves the first
 * route-level document access query, then holds the caller until opened. The
 * query has already run, so the early access decision is fixed; the writer has
 * not yet opened its write transaction.
 */
export function accessGate(pool: Pool) {
  let markEntered: () => void = () => undefined
  let openGate: () => void = () => undefined
  let armed = true
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const opened = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const query = pool.query.bind(pool) as Pool['query']
  return {
    entered,
    open: () => openGate(),
    pool: {
      query: async (sql: string, parameters?: unknown[]) => {
        const result = await query(sql, parameters)
        if (
          armed &&
          sql.includes('from matter_documents document') &&
          sql.includes('join matters matter')
        ) {
          armed = false
          markEntered()
          await opened
        }
        return result
      },
      connect: () => pool.connect(),
    } as unknown as Pool,
  }
}

export async function state(pool: Pool, seed: Seed) {
  const versions = await pool.query<{ n: number }>(
    `select count(*)::int as n from document_versions where matter_document_id = $1`,
    [seed.documentId],
  )
  const pointer = await pool.query<{ current_version_id: string | null }>(
    `select current_version_id from matter_documents where id = $1`,
    [seed.documentId],
  )
  const comments = await pool.query<{ n: number }>(
    `select count(*)::int as n from document_comments where document_id = $1 and resolved_at is null`,
    [seed.documentId],
  )
  const shares = await pool.query<{ n: number }>(
    `select count(*)::int as n from matter_shares where matter_id = $1`,
    [seed.matterId],
  )
  return {
    versions: versions.rows[0]?.n ?? 0,
    currentVersionId: pointer.rows[0]?.current_version_id ?? null,
    unresolvedComments: comments.rows[0]?.n ?? 0,
    shares: shares.rows[0]?.n ?? 0,
  }
}

export async function auditCount(pool: Pool, seed: Seed, actions: string[]) {
  const result = await pool.query<{ n: number }>(
    `select count(*)::int as n from audit_logs
     where organisation_id = $1 and action = any($2)`,
    [seed.orgId, actions],
  )
  return result.rows[0]?.n ?? 0
}

export function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function expectConcealed(response: Response) {
  expect(response.status).toBe(404)
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'document_not_found' },
  })
}

interface WriteSpec {
  name: string
  kind: 'version' | 'comment'
  method: 'POST' | 'PATCH'
  path: (seed: Seed) => string
  payload: (seed: Seed) => Record<string, unknown>
  successStatus: number
  actions: string[]
  unresolvedAfterWrite: number
}

export const specs: WriteSpec[] = [
  {
    name: 'document edit',
    kind: 'version',
    method: 'POST',
    path: (seed) => `/api/documents/${seed.documentId}/edit`,
    payload: (seed) => ({
      baseVersionId: seed.versionId,
      operations: [
        { type: 'replace_run_text', runId: editableRunId, text: 'Race edit' },
      ],
      trackChanges: false,
    }),
    successStatus: 201,
    actions: ['document.version_create', 'document.edit'],
    unresolvedAfterWrite: 1,
  },
  {
    name: 'collaboration merge',
    kind: 'version',
    method: 'POST',
    path: (seed) => `/api/documents/${seed.documentId}/collaboration/merge`,
    payload: (seed) => ({
      baseVersionId: seed.versionId,
      syncId: `sync_${seed.documentId}`,
      operations: [
        {
          type: 'replace_run_text',
          runId: editableRunId,
          text: 'Race merge',
        },
      ],
      trackChanges: false,
    }),
    successStatus: 201,
    actions: ['document.version_create', 'document.collaboration_merge'],
    unresolvedAfterWrite: 1,
  },
  {
    name: 'tracked-change decision',
    kind: 'version',
    method: 'POST',
    path: (seed) =>
      `/api/documents/${seed.documentId}/tracked-changes/decision`,
    payload: (seed) => ({
      baseVersionId: seed.versionId,
      action: 'accept',
      changeIds: [insertionId],
    }),
    successStatus: 201,
    actions: ['document.version_create', 'document.tracked_change_accept'],
    unresolvedAfterWrite: 1,
  },
  {
    name: 'comment create',
    kind: 'comment',
    method: 'POST',
    path: (seed) => `/api/documents/${seed.documentId}/comments`,
    payload: () => ({ body: 'Race comment', anchor }),
    successStatus: 201,
    actions: ['document.comment_create'],
    unresolvedAfterWrite: 2,
  },
  {
    name: 'comment resolve',
    kind: 'comment',
    method: 'PATCH',
    path: (seed) =>
      `/api/documents/${seed.documentId}/comments/${seed.commentId}/resolve`,
    payload: () => ({}),
    successStatus: 200,
    actions: ['document.comment_resolve'],
    unresolvedAfterWrite: 0,
  },
]
