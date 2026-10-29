import type { Pool, PoolClient } from 'pg'
import type { MatterAccessLevel } from '@obiter/contracts'
import type { AuthenticatedOrgUser } from './authz'
import { matterAccessPredicate } from './matter-access-boundary'
import { lockMatterForEdit } from './matter-lock'
import type {
  CreateDocumentInput,
  DocumentVersionRecord,
  InsertDocumentVersionInput,
  MatterDocumentRecord,
} from './database-records'
import {
  type Queryable,
  documentColumns,
  firstOrNull,
  mapDocument,
  mapVersion,
  versionColumns,
  type DocumentVersionRow,
  type MatterDocumentRow,
} from './database-rows'

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

export async function insertDocumentVersion(
  client: PoolClient,
  input: InsertDocumentVersionInput,
) {
  const result = await client.query<DocumentVersionRow>(
    `
      insert into document_versions (
        id, organisation_id, matter_id, matter_document_id, filename, file_type,
        size_bytes, object_key, text_object_key, document_status, failure_reason,
        version_number, content_sha256, sync_state, created_by, lineage,
        created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, now(), now()
      )
      returning ${versionColumns}
    `,
    [
      input.id,
      input.organisationId,
      input.matterId,
      input.documentId,
      input.filename,
      input.fileType,
      input.sizeBytes,
      input.objectKey,
      input.textObjectKey,
      input.documentStatus,
      input.failureReason,
      input.versionNumber,
      input.contentSha256,
      input.syncState,
      input.createdBy,
      input.lineage == null ? null : JSON.stringify(input.lineage),
    ],
  )
  return mapVersion(result.rows[0])
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

    const created = await createDocumentInTransaction(client, input)
    if (!created) {
      await client.query('rollback')
      return null
    }
    await client.query('commit')
    return created
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/** The caller owns commit/rollback when a document is part of a larger write. */
export async function createDocumentInTransaction(
  client: PoolClient,
  input: CreateDocumentInput,
): Promise<{
  document: MatterDocumentRecord
  version: DocumentVersionRecord
} | null> {
  // Matter lock before the document insert, so an upload cannot commit on a
  // share revocation or removed membership that landed while it was queued.
  if (
    !(await lockMatterForEdit(client, {
      organisationId: input.organisationId,
      matterId: input.matterId,
      userId: input.userId,
    }))
  ) {
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

  const version = await insertDocumentVersion(client, {
    id: versionId,
    organisationId: input.organisationId,
    matterId: input.matterId,
    documentId: document.id,
    filename: input.filename,
    fileType: input.fileType,
    sizeBytes: input.sizeBytes,
    objectKey,
    textObjectKey: null,
    documentStatus: 'queued',
    failureReason: null,
    versionNumber: 1,
    contentSha256: input.contentSha256,
    syncState: input.syncState ?? 'synced',
    createdBy: input.userId,
  })

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

  return { document: mapDocument(updatedDocumentResult.rows[0]), version }
}

export async function updateDocumentExtraction(
  pool: Pick<Pool, 'query'>,
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
  user: AuthenticatedOrgUser,
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
      join matters matter
        on matter.id = d.matter_id
       and matter.organisation_id = d.organisation_id
      where d.organisation_id = $1
        and d.matter_id = $2
        and ($3::boolean or d.deleted_at is null)
        and ${matterAccessPredicate('$4', "'view'")}
      order by d.created_at desc
    `,
    [user.organisationId, matterId, options.includeDeleted === true, user.id],
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
  user: AuthenticatedOrgUser,
  id: string,
  requiredLevel: MatterAccessLevel,
  options: { includeDeleted?: boolean } = {},
): Promise<{
  document: MatterDocumentRecord
  versions: DocumentVersionRecord[]
} | null> {
  const documentResult = await pool.query<MatterDocumentRow>(
    `
      select ${documentColumns.replaceAll(/\b([a-z_]+)\b/g, 'document.$1')}
      from matter_documents document
      join matters matter
        on matter.id = document.matter_id
       and matter.organisation_id = document.organisation_id
      where document.id = $1
        and document.organisation_id = $2
        and ($3::boolean or document.deleted_at is null)
        and ${matterAccessPredicate('$4', '$5')}
    `,
    [
      id,
      user.organisationId,
      options.includeDeleted === true,
      user.id,
      requiredLevel,
    ],
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
    [user.organisationId, id],
  )
  const versions = versionsResult.rows.map(mapVersion)
  const currentVersion = document.currentVersionId
    ? await getDocumentVersion(
        pool,
        user.organisationId,
        document.currentVersionId,
      )
    : null

  return {
    document: {
      ...document,
      currentVersion,
    },
    versions,
  }
}
