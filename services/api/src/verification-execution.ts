import type { Pool } from 'pg'
import type { VerificationFinding, VerificationSubject } from '@obiter/verification-core'
import type { VerificationFailureCode } from '@obiter/contracts'
import type { AuthenticatedOrgUser } from './authz'
import { appendAuditLog } from './database'
import { getDocumentModel, DocumentModelStoreError } from './document-model-store'
import { matterAccessPredicate } from './matter-access-boundary'
import type { StorageService } from './storage'
import { collectVerificationFindings } from './verification-checks'
import {
  completeVerificationRun,
  insertVerificationRun,
  lockVerificationRunForVersion,
  markVerificationRunRunning,
  replaceVerificationFindings,
} from './verification-database'
import {
  extractVerificationCandidates,
  VerificationExtractionLimitError,
} from './verification-extraction'

type LockedVersion = {
  matterId: string
  documentId: string
  versionId: string
  objectKey: string
}

export type VerificationRunDenied =
  | { reason: 'not_found' }
  | { reason: 'version_not_ready' }

async function lockRunnableVersion(
  client: Pick<Pool, 'query'>,
  user: AuthenticatedOrgUser,
  documentId: string,
  versionId: string,
): Promise<LockedVersion | VerificationRunDenied> {
  const result = await client.query<{
    matter_id: string
    document_id: string
    version_id: string
    object_key: string
    document_status: string
  }>(
    `select matter.id as matter_id,
            document.id as document_id,
            version.id as version_id,
            version.object_key,
            version.document_status
     from matter_documents document
     join matters matter
       on matter.id = document.matter_id
      and matter.organisation_id = document.organisation_id
     join document_versions version
       on version.matter_document_id = document.id
      and version.matter_id = document.matter_id
      and version.organisation_id = document.organisation_id
     where document.id = $1
       and version.id = $2
       and document.organisation_id = $3
       and document.deleted_at is null
       and matter.deleted_at is null
       and ${matterAccessPredicate('$4', "'edit'")}
     for update`,
    [documentId, versionId, user.organisationId, user.id],
  )
  const row = result.rows[0]
  if (!row) return { reason: 'not_found' }
  if (row.document_status !== 'ready') return { reason: 'version_not_ready' }
  return {
    matterId: row.matter_id,
    documentId: row.document_id,
    versionId: row.version_id,
    objectKey: row.object_key,
  }
}

function auditMetadata(
  documentId: string,
  versionId: string,
  status: string,
  findingCount: number | null,
) {
  return {
    documentId,
    versionId,
    status,
    findingCount,
  }
}

export async function createAndExecuteVerificationRun(input: {
  pool: Pool
  storage: StorageService
  user: AuthenticatedOrgUser
  documentId: string
  versionId: string
  requestId: string
}): Promise<
  | { ok: true; runId: string }
  | { ok: false; denied: VerificationRunDenied }
> {
  const client = await input.pool.connect()
  let runId: string | null = null
  let locked: LockedVersion | VerificationRunDenied
  try {
    await client.query('begin')
    locked = await lockRunnableVersion(
      client,
      input.user,
      input.documentId,
      input.versionId,
    )
    if ('reason' in locked) {
      await client.query('rollback')
      return { ok: false, denied: locked }
    }
    const existing = await lockVerificationRunForVersion(client, {
      organisationId: input.user.organisationId,
      documentId: locked.documentId,
      documentVersionId: locked.versionId,
    })
    if (existing?.status === 'completed' || existing?.status === 'running') {
      await client.query('commit')
      return { ok: true, runId: existing.id }
    }
    runId =
      existing?.id ??
      (await insertVerificationRun(client, {
        id: `vrun_${crypto.randomUUID()}`,
        organisationId: input.user.organisationId,
        matterId: locked.matterId,
        documentId: locked.documentId,
        documentVersionId: locked.versionId,
        createdBy: input.user.id,
      }))
    if (!runId) {
      const raced = await lockVerificationRunForVersion(client, {
        organisationId: input.user.organisationId,
        documentId: locked.documentId,
        documentVersionId: locked.versionId,
      })
      await client.query('commit')
      if (!raced) return { ok: false, denied: { reason: 'not_found' } }
      return { ok: true, runId: raced.id }
    }
    if (!existing) {
      await appendAuditLog(client, {
        organisationId: input.user.organisationId,
        userId: input.user.id,
        entityType: 'verification_run',
        entityId: runId,
        action: 'verification.run_create',
        metadata: auditMetadata(
          locked.documentId,
          locked.versionId,
          'queued',
          null,
        ),
        requestId: input.requestId,
      })
    }
    await markVerificationRunRunning(
      client,
      input.user.organisationId,
      runId,
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  if ('reason' in locked || !runId) {
    return { ok: false, denied: { reason: 'not_found' } }
  }

  return executeVerificationRun({
    pool: input.pool,
    storage: input.storage,
    user: input.user,
    runId,
    version: locked,
    requestId: input.requestId,
  })
}

async function executeVerificationRun(input: {
  pool: Pool
  storage: StorageService
  user: AuthenticatedOrgUser
  runId: string
  version: LockedVersion
  requestId: string
}): Promise<{ ok: true; runId: string }> {
  const subject: VerificationSubject = {
    documentId: input.version.documentId,
    versionId: input.version.versionId,
  }
  let failureCode: VerificationFailureCode | null = null
  let findings: VerificationFinding[] = []
  try {
    const model = await getDocumentModel(input.storage, {
      id: input.version.versionId,
      organisationId: input.user.organisationId,
      matterId: input.version.matterId,
      matterDocumentId: input.version.documentId,
      objectKey: input.version.objectKey,
    })
    const extracted = extractVerificationCandidates(model)
    findings = await collectVerificationFindings(
      input.pool,
      subject,
      extracted.citations,
      extracted.quotes,
    )
  } catch (error) {
    if (error instanceof VerificationExtractionLimitError) {
      failureCode = 'execution_failed'
    } else if (error instanceof DocumentModelStoreError) {
      failureCode = 'model_unavailable'
    } else {
      failureCode = 'execution_failed'
    }
    console.warn('verification_execution_failed', {
      runId: input.runId,
      requestId: input.requestId,
      reason: error instanceof Error ? error.message : 'unknown failure',
    })
  }

  const client = await input.pool.connect()
  try {
    await client.query('begin')
    await replaceVerificationFindings(
      client,
      input.user.organisationId,
      input.runId,
      failureCode ? [] : findings,
    )
    await completeVerificationRun(client, {
      organisationId: input.user.organisationId,
      runId: input.runId,
      status: failureCode ? 'failed' : 'completed',
      failureCode,
    })
    await appendAuditLog(client, {
      organisationId: input.user.organisationId,
      userId: input.user.id,
      entityType: 'verification_run',
      entityId: input.runId,
      action: failureCode
        ? 'verification.run_fail'
        : 'verification.run_complete',
      metadata: auditMetadata(
        input.version.documentId,
        input.version.versionId,
        failureCode ? 'failed' : 'completed',
        failureCode ? null : findings.length,
      ),
      requestId: input.requestId,
    })
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  return { ok: true, runId: input.runId }
}
