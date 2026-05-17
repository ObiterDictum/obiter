import { Pool } from 'pg'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import type { CurrentOrganisation, CurrentUser, UserRole } from '@ormont/contracts'
import type { ApiEnv } from './env'

export interface SessionUserRecord {
  id: string
  email: string
  name: string
  organisationId?: string | null
  role?: UserRole | null
}

export interface AuditRecordInput {
  organisationId: string
  userId: string | null
  entityType: string
  entityId: string
  action:
    | 'auth.sign_in'
    | 'auth.sign_out'
    | 'matter.create'
    | 'matter.update'
    | 'matter.delete'
    | 'document.upload'
    | 'document.version_create'
    | 'document.delete'
  metadata: Record<string, string | number | boolean | null>
  requestId: string
}

export type MatterStatus = 'active' | 'archived' | 'deleted'
export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'needs_review'
export type SyncState = 'local_only' | 'queued' | 'syncing' | 'synced' | 'conflict' | 'failed'

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
  status?: MatterStatus
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

export function toCurrentUser(user: SessionUserRecord): CurrentUser | null {
  if (!user.role) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  }
}

export async function appendAuditLog(pool: Pool, input: AuditRecordInput) {
  await pool.query(
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
}

type Queryable = Pick<Pool | PoolClient, 'query'>

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function nullableTimestamp(value: Date | string | null) {
  return value === null ? null : timestamp(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
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
  }
}

const matterColumns = `
  id, organisation_id, name, description, primary_jurisdiction,
  secondary_jurisdictions, legal_domains, client_reference, status,
  created_by, created_at, updated_at, deleted_at
`

const documentColumns = `
  id, organisation_id, matter_id, current_version_id, logical_key,
  created_by, created_at, updated_at, deleted_at
`

const versionColumns = `
  id, organisation_id, matter_id, matter_document_id, filename, file_type,
  size_bytes, object_key, text_object_key, document_status, failure_reason,
  version_number, content_sha256, sync_state, created_by, created_at, updated_at
`

export async function createMatter(pool: Pool, input: CreateMatterInput): Promise<MatterRecord> {
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
        deleted_at = case when $12 = 'deleted' then coalesce(deleted_at, now()) else deleted_at end,
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

export async function softDeleteMatter(
  pool: Pool,
  organisationId: string,
  id: string,
): Promise<MatterRecord | null> {
  const result = await pool.query<MatterRow>(
    `
      update matters
      set status = 'deleted', deleted_at = now(), updated_at = now()
      where id = $1
        and organisation_id = $2
        and deleted_at is null
      returning ${matterColumns}
    `,
    [id, organisationId],
  )

  return firstOrNull(result, mapMatter)
}

export async function restoreMatter(
  pool: Pool,
  organisationId: string,
  id: string,
): Promise<MatterRecord | null> {
  const result = await pool.query<MatterRow>(
    `
      update matters
      set status = 'active', deleted_at = null, updated_at = now()
      where id = $1
        and organisation_id = $2
        and deleted_at is not null
      returning ${matterColumns}
    `,
    [id, organisationId],
  )

  return firstOrNull(result, mapMatter)
}

function createDocumentVersionId() {
  return `ver_${crypto.randomUUID()}`
}

function createDocumentObjectKey(input: {
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
): Promise<{ document: MatterDocumentRecord; version: DocumentVersionRecord }> {
  const client = await pool.connect()

  try {
    await client.query('begin')

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

export async function listDocuments(
  pool: Pool,
  organisationId: string,
  matterId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MatterDocumentRecord[]> {
  const result = await pool.query<(MatterDocumentRow & { current_version: DocumentVersionRow | null })>(
    `
      select
        d.id, d.organisation_id, d.matter_id, d.current_version_id,
        d.logical_key, d.created_by, d.created_at, d.updated_at, d.deleted_at,
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
    currentVersion: row.current_version ? mapVersion(row.current_version) : null,
  }))
}

export async function getDocument(
  pool: Pool,
  organisationId: string,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<{ document: MatterDocumentRecord; versions: DocumentVersionRecord[] } | null> {
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

export async function softDeleteDocument(
  pool: Pool,
  organisationId: string,
  id: string,
): Promise<MatterDocumentRecord | null> {
  const result = await pool.query<MatterDocumentRow>(
    `
      update matter_documents
      set deleted_at = now(), updated_at = now()
      where id = $1
        and organisation_id = $2
        and deleted_at is null
      returning ${documentColumns}
    `,
    [id, organisationId],
  )

  return firstOrNull(result, mapDocument)
}
