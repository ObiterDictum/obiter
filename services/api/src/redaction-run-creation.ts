import type { Pool } from 'pg'
import type { DetectionMode, RedactionPolicyMode } from '@obiter/contracts'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { appendAuditLog } from './database'
import {
  computeSummary,
  mapRedactionRun,
  redactionRunColumns,
  redactionRunsFrom,
} from './redaction-database'
import type { RedactionRunRow } from './redaction-database'

async function findLiveRedetectionRun(
  queryable: RedactionRunQueryable,
  organisationId: string,
  sourceRunId: string,
) {
  const result = await queryable.query<RedactionRunRow>(
    `select ${redactionRunColumns} ${redactionRunsFrom}
     where run.organisation_id = $1
       and run.replaces_run_id = $2
       and run.deleted_at is null`,
    [organisationId, sourceRunId],
  )
  return result.rows[0] ? mapRedactionRun(result.rows[0]) : null
}

export async function getRedetectionRun(
  pool: Pool,
  organisationId: string,
  sourceRunId: string,
) {
  return findLiveRedetectionRun(pool, organisationId, sourceRunId)
}

interface CreateRedactionRunInput {
  pool: Pool
  id: string
  organisationId: string
  userId: string
  sourceFilename: string
  sourceTextObjectKey: string | null
  sourceFileObjectKey?: string | null
  sourceLayoutObjectKey?: string | null
  sourceMimeType?: string | null
  spans: RedactionSpan[]
  detectorVersion: string
  detectionMode: DetectionMode
  policyMode: RedactionPolicyMode
  replacesRunId?: string
  matterId?: string
  documentId?: string
  documentVersionId?: string
}

type RedactionRunQueryable = Pick<Pool, 'query'>

async function insertRedactionRun(
  queryable: RedactionRunQueryable,
  input: Omit<CreateRedactionRunInput, 'pool'>,
) {
  const matterId = input.matterId ?? null
  const documentId = input.documentId ?? null
  const documentVersionId = input.documentVersionId ?? null
  const linked = Boolean(matterId && documentId && documentVersionId)
  const spans = input.spans.map((span, index) => ({
    ...span,
    id: `span_${input.id}_${index + 1}`,
  }))
  const result = await queryable.query<RedactionRunRow>(
    `
      insert into redaction_runs (
        id, organisation_id, matter_id, document_id, document_version_id, source_filename, source_text_object_key,
        source_file_object_key, source_layout_object_key, source_mime_type,
        status, policy_mode, spans_json, decisions_json, summary_json, detector_version, detection_mode, replaces_run_id,
        created_by, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ready_for_review', $11, $12::jsonb, '{}'::jsonb, $13::jsonb, $14, $15, $16, $17, now(), now())
      returning id, organisation_id, matter_id, null::text as matter_name, document_id, document_version_id,
        source_filename, source_text_object_key, source_file_object_key, source_layout_object_key, source_mime_type,
        status, policy_mode, spans_json, decisions_json, output_artifact_id,
        summary_json, detector_version, detection_mode, replaces_run_id, null::text as replacement_run_id,
        created_by, created_at, updated_at, deleted_at, deleted_by
    `,
    [
      input.id,
      input.organisationId,
      linked ? matterId : null,
      linked ? documentId : null,
      linked ? documentVersionId : null,
      input.sourceFilename,
      input.sourceTextObjectKey,
      linked ? null : (input.sourceFileObjectKey ?? null),
      linked ? null : (input.sourceLayoutObjectKey ?? null),
      linked ? null : (input.sourceMimeType ?? null),
      input.policyMode,
      JSON.stringify(spans),
      JSON.stringify(computeSummary(spans, {})),
      input.detectorVersion,
      input.detectionMode,
      input.replacesRunId ?? null,
      input.userId,
    ],
  )
  return mapRedactionRun(result.rows[0])
}

async function lockLinkedRunParents(
  queryable: RedactionRunQueryable,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    documentVersionId: string
  },
) {
  const matter = await queryable.query<{ id: string }>(
    `select id from matters
     where id = $1 and organisation_id = $2 and deleted_at is null
     for update`,
    [input.matterId, input.organisationId],
  )
  if (matter.rows.length === 0) return false

  const document = await queryable.query<{ id: string }>(
    `select id from matter_documents
     where id = $1
       and organisation_id = $2
       and matter_id = $3
       and current_version_id = $4
       and deleted_at is null
     for update`,
    [
      input.documentId,
      input.organisationId,
      input.matterId,
      input.documentVersionId,
    ],
  )
  return document.rows.length > 0
}

async function lockRedetectionParents(
  queryable: RedactionRunQueryable,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    documentVersionId: string
  },
) {
  const result = await queryable.query<{ id: string }>(
    `select version.id
     from matter_documents document
     join matters matter
       on matter.id = document.matter_id
      and matter.organisation_id = document.organisation_id
     join document_versions version
       on version.id = $4
      and version.matter_document_id = document.id
      and version.matter_id = document.matter_id
      and version.organisation_id = document.organisation_id
     where document.id = $1
       and document.organisation_id = $2
       and document.matter_id = $3
       and document.deleted_at is null
       and matter.deleted_at is null
     for update of document, matter`,
    [
      input.documentId,
      input.organisationId,
      input.matterId,
      input.documentVersionId,
    ],
  )
  return result.rows.length > 0
}

export async function createRedactionRun(input: CreateRedactionRunInput) {
  const matterId = input.matterId ?? null
  const documentId = input.documentId ?? null
  const documentVersionId = input.documentVersionId ?? null
  const linkedSource =
    matterId && documentId && documentVersionId
      ? { matterId, documentId, documentVersionId }
      : null
  const { pool, ...runInput } = input

  if (!linkedSource) return insertRedactionRun(pool, runInput)

  const client = await pool.connect()
  try {
    await client.query('begin')
    const parentsExist = await lockLinkedRunParents(client, {
      organisationId: input.organisationId,
      ...linkedSource,
    })
    if (!parentsExist) {
      await client.query('rollback')
      return null
    }

    const run = await insertRedactionRun(client, runInput)
    await client.query('commit')
    return run
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function createRedetectionRun(input: {
  pool: Pool
  organisationId: string
  userId: string
  sourceRunId: string
  newRunId: string
  sourceTextObjectKey: string | null
  spans: RedactionSpan[]
  detectorVersion: string
  detectionMode: Extract<DetectionMode, 'model+supplement'>
  requestId: string
}) {
  const client = await input.pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query<RedactionRunRow>(
      `select ${redactionRunColumns} ${redactionRunsFrom}
       where run.id = $1 and run.organisation_id = $2 and run.deleted_at is null
       for update of run`,
      [input.sourceRunId, input.organisationId],
    )
    if (!locked.rows[0]) {
      await client.query('rollback')
      return { kind: 'not_found' as const }
    }
    const sourceRun = mapRedactionRun(locked.rows[0])
    if (sourceRun.detectionMode === 'model+supplement') {
      await client.query('rollback')
      return { kind: 'already_model_detected' as const }
    }
    const existing = await findLiveRedetectionRun(
      client,
      input.organisationId,
      sourceRun.id,
    )
    if (existing) {
      await client.query('rollback')
      return { kind: 'existing' as const, run: existing }
    }

    const linkedSource =
      sourceRun.matterId && sourceRun.documentId && sourceRun.documentVersionId
        ? {
            matterId: sourceRun.matterId,
            documentId: sourceRun.documentId,
            documentVersionId: sourceRun.documentVersionId,
          }
        : null
    if (linkedSource) {
      const parentsExist = await lockRedetectionParents(client, {
        organisationId: sourceRun.organisationId,
        ...linkedSource,
      })
      if (!parentsExist) {
        await client.query('rollback')
        return { kind: 'linked_source_unavailable' as const }
      }
    }

    const run = await insertRedactionRun(client, {
      id: input.newRunId,
      organisationId: sourceRun.organisationId,
      userId: input.userId,
      sourceFilename: sourceRun.sourceFilename,
      sourceTextObjectKey: linkedSource ? null : input.sourceTextObjectKey,
      spans: input.spans,
      detectorVersion: input.detectorVersion,
      detectionMode: input.detectionMode,
      policyMode: sourceRun.policyMode,
      replacesRunId: sourceRun.id,
      ...linkedSource,
    })
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'redaction_run',
      entityId: sourceRun.id,
      action: 'redaction.run_redetect',
      metadata: {
        replacementRunId: run.id,
        previousDetectionMode: sourceRun.detectionMode,
        replacementDetectionMode: run.detectionMode,
      },
      requestId: input.requestId,
    })
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction.run_create',
      metadata: {
        policyMode: run.policyMode,
        detectionMode: run.detectionMode,
        spanCount: run.spans.length,
        redetectedFromRunId: sourceRun.id,
      },
      requestId: input.requestId,
    })
    await client.query('commit')
    return { kind: 'created' as const, run }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
