import { Pool } from 'pg'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import type {
  CurrentOrganisation,
  CurrentUser,
  UserRole,
} from '@obiter/contracts'
import type { ApiEnv } from './env'

export interface SessionUserRecord {
  id: string
  email: string
  name: string
  organisationId?: string | null
  role?: UserRole | null
}

export interface AuditRecordInput {
  // nullable: auth audit rows (sign-in/sign-up) are written for org-less users
  // before they create an organisation (audit_logs.organisation_id is nullable
  // as of migration 0009). Org-scoped actions always pass a real id.
  organisationId: string | null
  userId: string | null
  entityType: string
  entityId: string
  action:
    | 'auth.sign_in'
    | 'auth.sign_up'
    | 'auth.sign_out'
    | 'organisation.create'
    | 'matter.create'
    | 'matter.update'
    | 'matter.delete'
    | 'matter.restore'
    | 'matter.share_grant'
    | 'matter.share_revoke'
    | 'document.upload'
    | 'document.version_create'
    | 'document.delete'
    | 'document.restore'
    | 'document.comment_create'
    | 'document.comment_resolve'
    | 'redaction.run_create'
    | 'redaction.run_redetect'
    | 'redaction.span_decision'
    | 'redaction.finalize'
    | 'redaction.token_map_access'
    | 'redaction_run.delete'
    | 'redaction_run.restore'
  metadata: Record<string, string | number | boolean | null | string[]>
  requestId: string
}

export type MatterStatus = 'active' | 'archived' | 'deleted'
export type UpdatableMatterStatus = Exclude<MatterStatus, 'deleted'>
export type DocumentStatus =
  'queued' | 'processing' | 'ready' | 'failed' | 'needs_review'
export type SyncState =
  'local_only' | 'queued' | 'syncing' | 'synced' | 'conflict' | 'failed'

export interface MatterRecord {
  id: string
  organisationId: string
  name: string
  description: string | null
  primaryJurisdiction: string
  secondaryJurisdictions: string[]
  legalDomains: string[]
  clientReference: string
  status: MatterStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
}

export interface DocumentVersionRecord {
  id: string
  organisationId: string
  matterId: string
  matterDocumentId: string
  filename: string
  fileType: string
  sizeBytes: string
  objectKey: string
  textObjectKey: string | null
  documentStatus: DocumentStatus
  failureReason: string | null
  versionNumber: number
  contentSha256: string
  syncState: SyncState
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface MatterDocumentRecord {
  id: string
  organisationId: string
  matterId: string
  currentVersionId: string | null
  logicalKey: string
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
  currentVersion?: DocumentVersionRecord | null
}

export interface CreateMatterInput {
  organisationId: string
  userId: string
  name: string
  description?: string | null
  primaryJurisdiction: string
  secondaryJurisdictions?: string[]
  legalDomains?: string[]
  clientReference?: string
}

export interface UpdateMatterInput {
  name?: string
  description?: string | null
  primaryJurisdiction?: string
  secondaryJurisdictions?: string[]
  legalDomains?: string[]
  clientReference?: string
  status?: UpdatableMatterStatus
}

export interface RestoreMatterInput {
  organisationId: string
  userId: string
  id: string
  requestId: string
}

export interface CreateDocumentInput {
  organisationId: string
  matterId: string
  userId: string
  filename: string
  fileType: string
  sizeBytes: number
  contentSha256: string
  syncState?: SyncState
}

export function createPool(env: ApiEnv) {
  return new Pool({
    connectionString: env.databaseUrl,
  })
}

type Queryable = Pick<Pool | PoolClient, 'query'>

export async function findOrganisation(
  pool: Pool,
  organisationId: string,
): Promise<CurrentOrganisation | null> {
  const result = await pool.query<{
    id: string
    name: string
    plan: CurrentOrganisation['plan']
  }>(
    `
      select id, name, plan
      from organisations
      where id = $1
    `,
    [organisationId],
  )

  return result.rows[0] ?? null
}

/**
 * Creates an organisation, assigns the creating user to it as owner, and
 * writes the audit row — all in one transaction. The single-org invariant is
 * enforced in code here: the user row is locked with SELECT ... FOR UPDATE
 * and the function rejects (returns `{ created: false }`, 409 in the route)
 * if the user already has an organisationId. No DB-level unique constraint
 * backs this — a per-user index would be wrong (it would allow distinct
 * organisations per user rather than serialising the same-user race, and a
 * one-organisation-per-user index would block future multi-member orgs). The
 * row lock serialises concurrent creation for the same user.
 *
 * If the user row is missing entirely, the function rolls back and throws so
 * the caller surfaces a 500 rather than inserting an orphan organisation +
 * audit row. Any other failure likewise throws.
 *
 * When the user already has an organisation, returns `{ created: false,
 * organisationId, role }` so callers that auto-provision (matters/redact) can
 * continue with the existing tenant without a second lookup.
 */
export async function createOrganisationForUser(
  pool: Pool,
  input: { userId: string; name: string; requestId: string },
): Promise<
  | {
      created: false
      organisationId: string
      role: UserRole
    }
  | { created: true; organisation: CurrentOrganisation }
> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const existing = await client['query']<{
      organisationId: string | null
      role: UserRole | null
    }>(`select "organisationId", role from users where id = $1 for update`, [
      input.userId,
    ])
    if (existing.rows.length === 0) {
      // No user row: a data-integrity failure, not the normal org-less state.
      // Fail closed rather than inserting an organisation nothing references.
      await client.query('rollback')
      throw new Error('User record not found.')
    }
    const current = existing.rows[0]
    const currentOrgId = current?.organisationId
    if (currentOrgId) {
      await client.query('rollback')
      return {
        created: false,
        organisationId: currentOrgId,
        role: current.role ?? 'member',
      }
    }

    const organisation = await client['query']<{
      id: string
      name: string
      plan: CurrentOrganisation['plan']
    }>(
      `
        insert into organisations (name, created_at, updated_at)
        values ($1, now(), now())
        returning id, name, plan
      `,
      [input.name],
    )
    const created = organisation.rows[0]

    await client['query'](
      `update users set "organisationId" = $1, role = 'owner', "updatedAt" = now() where id = $2`,
      [created.id, input.userId],
    )

    await appendAuditLog(client, {
      organisationId: created.id,
      userId: input.userId,
      entityType: 'organisation',
      entityId: created.id,
      action: 'organisation.create',
      metadata: { name: input.name },
      requestId: input.requestId,
    })

    await client.query('commit')
    return { created: true, organisation: created }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/** Default tenant name when an org-less user first hits Matters or Redact. */
export const PERSONAL_WORKSPACE_NAME = 'Personal workspace'

/**
 * Ensures the user has an organisation for tenant-scoped product data.
 * Creates a personal workspace when still org-less; otherwise returns the
 * existing organisation. Used by Matters/Documents/Redact auth helpers so
 * product surfaces work without a prior Settings visit.
 */
export async function ensureOrganisationForUser(
  pool: Pool,
  input: { userId: string; requestId: string },
): Promise<{ organisationId: string; role: UserRole; created: boolean }> {
  const result = await createOrganisationForUser(pool, {
    userId: input.userId,
    name: PERSONAL_WORKSPACE_NAME,
    requestId: input.requestId,
  })
  if (result.created) {
    return {
      organisationId: result.organisation.id,
      role: 'owner',
      created: true,
    }
  }
  return {
    organisationId: result.organisationId,
    role: result.role,
    created: false,
  }
}

// An org-less user has role null; /api/me returns them with organisation null
// so the client can offer optional organisation setup in Settings.
export function toCurrentUser(user: SessionUserRecord): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? null,
  }
}

export async function appendAuditLog(
  client: Queryable,
  input: AuditRecordInput,
) {
  await client['query'](
    `
      insert into audit_logs (
        id,
        organisation_id,
        user_id,
        entity_type,
        entity_id,
        action,
        metadata_json,
        request_id,
        created_at
      )
      values (
        gen_random_uuid()::text,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7,
        now()
      )
    `,
    [
      input.organisationId,
      input.userId,
      input.entityType,
      input.entityId,
      input.action,
      JSON.stringify(input.metadata),
      input.requestId,
    ],
  )
}

type MatterRow = {
  id: string
  organisation_id: string
  name: string
  description: string | null
  primary_jurisdiction: string
  secondary_jurisdictions: string[]
  legal_domains: string[]
  client_reference: string
  status: MatterStatus
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  deleted_by: string | null
}

type DocumentVersionRow = {
  id: string
  organisation_id: string
  matter_id: string
  matter_document_id: string
  filename: string
  file_type: string
  size_bytes: string
  object_key: string
  text_object_key: string | null
  document_status: DocumentStatus
  failure_reason: string | null
  version_number: number
  content_sha256: string
  sync_state: SyncState
  created_by: string
  created_at: Date | string
  updated_at: Date | string
}

type MatterDocumentRow = {
  id: string
  organisation_id: string
  matter_id: string
  current_version_id: string | null
  logical_key: string
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  deleted_by: string | null
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function nullableTimestamp(value: Date | string | null) {
  return value === null ? null : timestamp(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function firstOrNull<Row extends QueryResultRow, Record>(
  result: QueryResult<Row>,
  mapper: (row: Row) => Record,
): Record | null {
  const row = result.rows[0]
  return row ? mapper(row) : null
}

function mapMatter(row: MatterRow): MatterRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    description: row.description,
    primaryJurisdiction: row.primary_jurisdiction,
    secondaryJurisdictions: stringArray(row.secondary_jurisdictions),
    legalDomains: stringArray(row.legal_domains),
    clientReference: row.client_reference,
    status: row.status,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: nullableTimestamp(row.deleted_at),
    deletedBy: row.deleted_by,
  }
}

function mapVersion(row: DocumentVersionRow): DocumentVersionRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    matterId: row.matter_id,
    matterDocumentId: row.matter_document_id,
    filename: row.filename,
    fileType: row.file_type,
    sizeBytes: row.size_bytes,
    objectKey: row.object_key,
    textObjectKey: row.text_object_key,
    documentStatus: row.document_status,
    failureReason: row.failure_reason,
    versionNumber: row.version_number,
    contentSha256: row.content_sha256,
    syncState: row.sync_state,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function mapDocument(row: MatterDocumentRow): MatterDocumentRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    matterId: row.matter_id,
    currentVersionId: row.current_version_id,
    logicalKey: row.logical_key,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: nullableTimestamp(row.deleted_at),
    deletedBy: row.deleted_by,
  }
}

const matterColumns = `
  id, organisation_id, name, description, primary_jurisdiction,
  secondary_jurisdictions, legal_domains, client_reference, status,
  created_by, created_at, updated_at, deleted_at, deleted_by
`

const documentColumns = `
  id, organisation_id, matter_id, current_version_id, logical_key,
  created_by, created_at, updated_at, deleted_at, deleted_by
`

const versionColumns = `
  id, organisation_id, matter_id, matter_document_id, filename, file_type,
  size_bytes, object_key, text_object_key, document_status, failure_reason,
  version_number, content_sha256, sync_state, created_by, created_at, updated_at
`

export async function createMatter(
  pool: Pool,
  input: CreateMatterInput,
): Promise<MatterRecord> {
  const result = await pool.query<MatterRow>(
    `
      insert into matters (
        organisation_id, name, description, primary_jurisdiction,
        secondary_jurisdictions, legal_domains, client_reference,
        status, created_by, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'active', $8, now(), now())
      returning ${matterColumns}
    `,
    [
      input.organisationId,
      input.name,
      input.description ?? null,
      input.primaryJurisdiction,
      JSON.stringify(input.secondaryJurisdictions ?? []),
      JSON.stringify(input.legalDomains ?? []),
      input.clientReference ?? '',
      input.userId,
    ],
  )

  return mapMatter(result.rows[0])
}

export async function listMatters(
  pool: Pool,
  organisationId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MatterRecord[]> {
  const result = await pool.query<MatterRow>(
    `
      select ${matterColumns}
      from matters
      where organisation_id = $1
        and ($2::boolean or deleted_at is null)
      order by created_at desc
    `,
    [organisationId, options.includeDeleted === true],
  )

  return result.rows.map(mapMatter)
}

export async function getMatter(
  pool: Pool,
  organisationId: string,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MatterRecord | null> {
  const result = await pool.query<MatterRow>(
    `
      select ${matterColumns}
      from matters
      where id = $1
        and organisation_id = $2
        and ($3::boolean or deleted_at is null)
    `,
    [id, organisationId, options.includeDeleted === true],
  )

  return firstOrNull(result, mapMatter)
}

export async function updateMatter(
  pool: Pool,
  organisationId: string,
  id: string,
  input: UpdateMatterInput,
): Promise<MatterRecord | null> {
  const result = await pool.query<MatterRow>(
    `
      update matters
      set name = coalesce($3, name),
        description = case when $4::boolean then $5 else description end,
        primary_jurisdiction = coalesce($6, primary_jurisdiction),
        secondary_jurisdictions = case when $7::boolean then $8::jsonb else secondary_jurisdictions end,
        legal_domains = case when $9::boolean then $10::jsonb else legal_domains end,
        client_reference = coalesce($11, client_reference),
        status = coalesce($12, status),
        updated_at = now()
      where id = $1
        and organisation_id = $2
        and deleted_at is null
      returning ${matterColumns}
    `,
    [
      id,
      organisationId,
      input.name ?? null,
      Object.hasOwn(input, 'description'),
      input.description ?? null,
      input.primaryJurisdiction ?? null,
      Object.hasOwn(input, 'secondaryJurisdictions'),
      JSON.stringify(input.secondaryJurisdictions ?? []),
      Object.hasOwn(input, 'legalDomains'),
      JSON.stringify(input.legalDomains ?? []),
      input.clientReference ?? null,
      input.status ?? null,
    ],
  )

  return firstOrNull(result, mapMatter)
}

export interface DeleteCascadeResult {
  matter: MatterRecord
  documents: MatterDocumentRecord[]
  runs: { id: string }[]
}

/**
 * Soft-deletes a matter and cascades to its documents and their redaction runs
 * in one transaction, writing one `*.delete` audit row per deleted entity.
 *
 * Provenance: every `set deleted_at = now()` in this transaction shares one
 * transaction-stable timestamp `T`. Already-deleted children are skipped
 * (`where deleted_at is null`), so cascade-restore (below) can match only the
 * children this cascade took down by `deleted_at = T` — an individually-deleted
 * child (older timestamp) is not revived. See docs/prds/platform-deletion.md.
 *
 * Returns null when the matter is missing, cross-org, or already deleted —
 * the caller surfaces a 404 without writing any audit row (no existence leak).
 */
export async function softDeleteMatterWithCascade(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    id: string
    requestId: string
  },
): Promise<DeleteCascadeResult | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const lock = await client.query<{ id: string }>(
      `select id from matters
       where id = $1 and organisation_id = $2 and deleted_at is null
       for update`,
      [input.id, input.organisationId],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    const matterResult = await client.query<MatterRow>(
      `
        update matters
        set status = 'deleted', deleted_at = now(), deleted_by = $3, updated_at = now()
        where id = $1 and organisation_id = $2 and deleted_at is null
        returning ${matterColumns}
      `,
      [input.id, input.organisationId, input.userId],
    )
    const matter = mapMatter(matterResult.rows[0])

    const documentsResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set deleted_at = now(), deleted_by = $3, updated_at = now()
        where matter_id = $1 and organisation_id = $2 and deleted_at is null
        returning ${documentColumns}
      `,
      [input.id, input.organisationId, input.userId],
    )
    const documents = documentsResult.rows.map(mapDocument)

    const runsResult = await client.query<{ id: string }>(
      `
        update redaction_runs
        set deleted_at = now(), deleted_by = $3, updated_at = now()
        where matter_id = $1 and organisation_id = $2 and deleted_at is null
        returning id
      `,
      [input.id, input.organisationId, input.userId],
    )
    const runs = runsResult.rows

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.delete',
      metadata: {
        documentCount: documents.length,
        runCount: runs.length,
      },
      requestId: input.requestId,
    })
    for (const document of documents) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'document',
        entityId: document.id,
        action: 'document.delete',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }
    for (const run of runs) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'redaction_run',
        entityId: run.id,
        action: 'redaction_run.delete',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }

    await client.query('commit')
    return { matter, documents, runs }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Cascade-restore symmetric with softDeleteMatterWithCascade. Reads the matter's
 * `deleted_at` (= T) under FOR UPDATE, then restores only children whose
 * `deleted_at = T` — the ones this matter's deletion took down. An
 * individually-deleted child (timestamp ≠ T) stays deleted.
 */
export async function restoreMatterWithAudit(
  pool: Pool,
  input: RestoreMatterInput,
): Promise<MatterRecord | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const lock = await client.query<{ deleted_at: string }>(
      `select deleted_at::text from matters
       where id = $1 and organisation_id = $2 and deleted_at is not null
       for update`,
      [input.id, input.organisationId],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return null
    }
    // Capture as text to preserve microsecond precision. The pg driver returns
    // timestamptz as a JS Date (millisecond precision); round-tripping that
    // back as a param would drop microseconds and break the equality match
    // against the stored value. Text keeps full fidelity so the cascade-restore
    // matches exactly the children this deletion took down.
    const cascadeTimestamp = lock.rows[0].deleted_at

    const matterResult = await client.query<MatterRow>(
      `
        update matters
        set status = 'active', deleted_at = null, deleted_by = null, updated_at = now()
        where id = $1 and organisation_id = $2 and deleted_at = $3::timestamptz
        returning ${matterColumns}
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const matter = mapMatter(matterResult.rows[0])

    const documentsResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set deleted_at = null, deleted_by = null, updated_at = now()
        where matter_id = $1 and organisation_id = $2 and deleted_at = $3::timestamptz
        returning ${documentColumns}
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const documents = documentsResult.rows.map(mapDocument)

    const runsResult = await client.query<{ id: string }>(
      `
        update redaction_runs
        set deleted_at = null, deleted_by = null, updated_at = now()
        where matter_id = $1
          and organisation_id = $2
          and deleted_at = $3::timestamptz
          and (
            document_id is null
            or exists (
              select 1
              from matter_documents document
              where document.id = redaction_runs.document_id
                and document.matter_id = redaction_runs.matter_id
                and document.organisation_id = redaction_runs.organisation_id
                and document.deleted_at is null
            )
          )
        returning id
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const runs = runsResult.rows

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.restore',
      metadata: {
        documentCount: documents.length,
        runCount: runs.length,
      },
      requestId: input.requestId,
    })
    for (const document of documents) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'document',
        entityId: document.id,
        action: 'document.restore',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }
    for (const run of runs) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'redaction_run',
        entityId: run.id,
        action: 'redaction_run.restore',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }

    await client.query('commit')
    return matter
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

function createDocumentVersionId() {
  return `ver_${crypto.randomUUID()}`
}

export function createDocumentObjectKey(input: {
  organisationId: string
  matterId: string
  documentId: string
  versionId: string
}) {
  return `org/${input.organisationId}/matters/${input.matterId}/documents/${input.documentId}/versions/${input.versionId}/source`
}

async function getDocumentVersion(
  client: Queryable,
  organisationId: string,
  versionId: string,
): Promise<DocumentVersionRecord | null> {
  const result = await client.query<DocumentVersionRow>(
    `
      select ${versionColumns}
      from document_versions
      where id = $1
        and organisation_id = $2
    `,
    [versionId, organisationId],
  )

  return firstOrNull(result, mapVersion)
}

export async function createDocument(
  pool: Pool,
  input: CreateDocumentInput,
): Promise<{
  document: MatterDocumentRecord
  version: DocumentVersionRecord
} | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const matter = await client.query<{ id: string }>(
      `select id from matters
       where id = $1 and organisation_id = $2 and deleted_at is null
       for update`,
      [input.matterId, input.organisationId],
    )
    if (matter.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    const documentResult = await client.query<MatterDocumentRow>(
      `
        insert into matter_documents (
          organisation_id, matter_id, created_by, created_at, updated_at
        )
        values ($1, $2, $3, now(), now())
        returning ${documentColumns}
      `,
      [input.organisationId, input.matterId, input.userId],
    )
    const document = mapDocument(documentResult.rows[0])

    const versionId = createDocumentVersionId()
    const objectKey = createDocumentObjectKey({
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: document.id,
      versionId,
    })

    const versionResult = await client.query<DocumentVersionRow>(
      `
        insert into document_versions (
          id, organisation_id, matter_id, matter_document_id, filename, file_type,
          size_bytes, object_key, document_status, version_number,
          content_sha256, sync_state, created_by, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 1, $9, $10, $11, now(), now())
        returning ${versionColumns}
      `,
      [
        versionId,
        input.organisationId,
        input.matterId,
        document.id,
        input.filename,
        input.fileType,
        input.sizeBytes,
        objectKey,
        input.contentSha256,
        input.syncState ?? 'synced',
        input.userId,
      ],
    )
    const version = mapVersion(versionResult.rows[0])

    const updatedDocumentResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set current_version_id = $3, updated_at = now()
        where id = $1
          and organisation_id = $2
        returning ${documentColumns}
      `,
      [document.id, input.organisationId, version.id],
    )

    await client.query('commit')
    return { document: mapDocument(updatedDocumentResult.rows[0]), version }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function updateDocumentExtraction(
  pool: Pool,
  input: {
    organisationId: string
    versionId: string
    textObjectKey?: string
    failureReason?: string
  },
): Promise<DocumentVersionRecord | null> {
  const isReady = input.textObjectKey !== undefined
  const result = await pool.query<DocumentVersionRow>(
    `update document_versions
     set text_object_key = $3,
         document_status = $4,
         failure_reason = $5,
         updated_at = now()
     where id = $1 and organisation_id = $2
     returning ${versionColumns}`,
    [
      input.versionId,
      input.organisationId,
      isReady ? input.textObjectKey : null,
      isReady ? 'ready' : 'failed',
      isReady
        ? null
        : (input.failureReason ?? 'Document text extraction failed.'),
    ],
  )
  return firstOrNull(result, mapVersion)
}

export async function listDocuments(
  pool: Pool,
  organisationId: string,
  matterId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MatterDocumentRecord[]> {
  const result = await pool.query<
    MatterDocumentRow & { current_version: DocumentVersionRow | null }
  >(
    `
      select
        d.id, d.organisation_id, d.matter_id, d.current_version_id,
        d.logical_key, d.created_by, d.created_at, d.updated_at, d.deleted_at, d.deleted_by,
        case when v.id is null then null else to_jsonb(v) end as current_version
      from matter_documents d
      left join document_versions v on v.id = d.current_version_id
      where d.organisation_id = $1
        and d.matter_id = $2
        and ($3::boolean or d.deleted_at is null)
      order by d.created_at desc
    `,
    [organisationId, matterId, options.includeDeleted === true],
  )

  return result.rows.map((row) => ({
    ...mapDocument(row),
    currentVersion: row.current_version
      ? mapVersion(row.current_version)
      : null,
  }))
}

export async function getDocument(
  pool: Pool,
  organisationId: string,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<{
  document: MatterDocumentRecord
  versions: DocumentVersionRecord[]
} | null> {
  const documentResult = await pool.query<MatterDocumentRow>(
    `
      select ${documentColumns}
      from matter_documents
      where id = $1
        and organisation_id = $2
        and ($3::boolean or deleted_at is null)
    `,
    [id, organisationId, options.includeDeleted === true],
  )
  const document = firstOrNull(documentResult, mapDocument)

  if (!document) {
    return null
  }

  const versionsResult = await pool.query<DocumentVersionRow>(
    `
      select ${versionColumns}
      from document_versions
      where organisation_id = $1
        and matter_document_id = $2
      order by version_number desc
    `,
    [organisationId, id],
  )
  const versions = versionsResult.rows.map(mapVersion)
  const currentVersion = document.currentVersionId
    ? await getDocumentVersion(pool, organisationId, document.currentVersionId)
    : null

  return {
    document: {
      ...document,
      currentVersion,
    },
    versions,
  }
}

export interface DeleteDocumentCascadeResult {
  document: MatterDocumentRecord
  runs: { id: string }[]
}

/**
 * Soft-deletes a document and cascades to its redaction runs in one
 * transaction, writing one `*.delete` audit row per deleted entity. Same
 * transaction-stable-timestamp provenance as softDeleteMatterWithCascade.
 * Returns null when the document is missing, cross-org, or already deleted.
 */
export async function softDeleteDocumentWithCascade(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    id: string
    requestId: string
  },
): Promise<DeleteDocumentCascadeResult | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const lock = await client.query<{ id: string }>(
      `select id from matter_documents
       where id = $1 and organisation_id = $2 and deleted_at is null
       for update`,
      [input.id, input.organisationId],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    const documentResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set deleted_at = now(), deleted_by = $3, updated_at = now()
        where id = $1 and organisation_id = $2 and deleted_at is null
        returning ${documentColumns}
      `,
      [input.id, input.organisationId, input.userId],
    )
    const document = mapDocument(documentResult.rows[0])

    const runsResult = await client.query<{ id: string }>(
      `
        update redaction_runs
        set deleted_at = now(), deleted_by = $3, updated_at = now()
        where document_id = $1 and organisation_id = $2 and deleted_at is null
        returning id
      `,
      [input.id, input.organisationId, input.userId],
    )
    const runs = runsResult.rows

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document',
      entityId: document.id,
      action: 'document.delete',
      metadata: { runCount: runs.length },
      requestId: input.requestId,
    })
    for (const run of runs) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'redaction_run',
        entityId: run.id,
        action: 'redaction_run.delete',
        metadata: { cascadedFrom: document.id },
        requestId: input.requestId,
      })
    }

    await client.query('commit')
    return { document, runs }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/** Restores a document and its cascade-deleted runs; intentionally not yet routed. */
export async function restoreDocumentWithAudit(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    id: string
    requestId: string
  },
): Promise<DeleteDocumentCascadeResult | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const candidate = await client.query<{ matter_id: string }>(
      `select matter_id from matter_documents
       where id = $1 and organisation_id = $2 and deleted_at is not null`,
      [input.id, input.organisationId],
    )
    if (candidate.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    const matterId = candidate.rows[0].matter_id
    const matter = await client.query<{ id: string }>(
      `select id from matters
       where id = $1 and organisation_id = $2 and deleted_at is null
       for update`,
      [matterId, input.organisationId],
    )
    if (matter.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    const lock = await client.query<{ deleted_at: string }>(
      `select deleted_at::text from matter_documents
       where id = $1
         and organisation_id = $2
         and matter_id = $3
         and deleted_at is not null
       for update`,
      [input.id, input.organisationId, matterId],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return null
    }
    const cascadeTimestamp = lock.rows[0].deleted_at

    const documentResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set deleted_at = null, deleted_by = null, updated_at = now()
        where id = $1
          and organisation_id = $2
          and deleted_at = $3::timestamptz
        returning ${documentColumns}
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const document = mapDocument(documentResult.rows[0])

    const runsResult = await client.query<{ id: string }>(
      `
        update redaction_runs
        set deleted_at = null, deleted_by = null, updated_at = now()
        where document_id = $1
          and organisation_id = $2
          and deleted_at = $3::timestamptz
        returning id
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const runs = runsResult.rows

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document',
      entityId: document.id,
      action: 'document.restore',
      metadata: { runCount: runs.length },
      requestId: input.requestId,
    })
    for (const run of runs) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'redaction_run',
        entityId: run.id,
        action: 'redaction_run.restore',
        metadata: { cascadedFrom: document.id },
        requestId: input.requestId,
      })
    }

    await client.query('commit')
    return { document, runs }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
