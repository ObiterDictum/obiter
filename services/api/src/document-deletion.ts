import type { Pool } from 'pg'
import { lockMatterForEdit } from './matter-lock'
import { appendAuditLog } from './audit-log'
import type { MatterDocumentRecord } from './database-records'
import {
  documentColumns,
  firstOrNull,
  mapDocument,
  type MatterDocumentRow,
} from './database-rows'

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

    // Unlocked routing read: it only names the parent matter. The matter lock
    // and the locked document re-read below are the authoritative checks.
    const candidate = await client.query<{ matter_id: string }>(
      `select matter_id from matter_documents
       where id = $1 and organisation_id = $2 and deleted_at is null`,
      [input.id, input.organisationId],
    )
    const matterId = candidate.rows[0]?.matter_id
    if (!matterId) {
      await client.query('rollback')
      return null
    }

    // Matter lock, fresh edit re-check and acting-member lock before the
    // document is locked and soft-deleted.
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId,
        userId: input.userId,
      }))
    ) {
      await client.query('rollback')
      return null
    }

    const lockedDocument = await client.query<{ id: string }>(
      `select id from matter_documents
       where id = $1
         and organisation_id = $2
         and matter_id = $3
         and deleted_at is null
       for update`,
      [input.id, input.organisationId, matterId],
    )
    if (!lockedDocument.rows[0]) {
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
    const document = firstOrNull(documentResult, mapDocument)
    if (!document) {
      await client.query('rollback')
      return null
    }

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

/** Restores a document and its cascade-deleted runs. */
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

    // Unlocked routing read: it only names the parent matter. The matter lock
    // and the locked document re-read below are the authoritative checks.
    const candidate = await client.query<{ matter_id: string }>(
      `select matter_id from matter_documents
       where id = $1 and organisation_id = $2 and deleted_at is not null`,
      [input.id, input.organisationId],
    )
    const matterId = candidate.rows[0]?.matter_id
    if (!matterId) {
      await client.query('rollback')
      return null
    }

    // Matter lock before the document lock, so a restore cannot commit on an
    // access fact that a revocation or member removal already changed.
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId,
        userId: input.userId,
      }))
    ) {
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
    const document = firstOrNull(documentResult, mapDocument)
    if (!document) {
      await client.query('rollback')
      return null
    }

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
