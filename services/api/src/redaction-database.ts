import type { Pool } from 'pg'
import { appendAuditLog } from './database'
import {
  detectionModeSchema,
  spanCategorySchema,
  spanConfidenceSchema,
  spanDecisionSchema,
  spanSourceSchema,
  spanSuggestionSchema,
} from '@obiter/contracts'
import type {
  DetectionMode,
  OutputMode,
  RedactionPolicyMode,
  RedactionRunStatus,
  SpanDecision,
} from '@obiter/contracts'
import type {
  Decisions,
  RedactionSpan,
  RunSummary,
  TokenMap,
} from '@obiter/redaction-policy'

const MAX_FINALIZE_AUDIT_SPAN_IDS = 100

export interface RedactionRunRecord {
  id: string
  organisationId: string
  matterId: string | null
  matterName: string | null
  documentId: string | null
  documentVersionId: string | null
  sourceFilename: string
  sourceTextObjectKey: string | null
  sourceFileObjectKey: string | null
  sourceLayoutObjectKey: string | null
  sourceMimeType: string | null
  status: RedactionRunStatus
  policyMode: RedactionPolicyMode
  spans: RedactionSpan[]
  decisions: Decisions
  outputArtifactId: string | null
  summary: RunSummary & {
    tokenMap?: TokenMap
    outputMode?: OutputMode
    outputMimeType?: string
    outputFilename?: string | null
  }
  detectorVersion: string | null
  detectionMode: DetectionMode
  replacesRunId: string | null
  replacementRunId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
}

export interface RedactionRunRow {
  id: string
  organisation_id: string
  matter_id: string | null
  matter_name: string | null
  document_id: string | null
  document_version_id: string | null
  source_filename: string
  source_text_object_key: string | null
  source_file_object_key: string | null
  source_layout_object_key: string | null
  source_mime_type: string | null
  status: RedactionRunStatus
  policy_mode: RedactionPolicyMode
  spans_json: unknown
  decisions_json: unknown
  output_artifact_id: string | null
  summary_json: unknown
  detector_version: string | null
  detection_mode: unknown
  replaces_run_id: string | null
  replacement_run_id: string | null
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  deleted_by: string | null
}

interface ArtifactRecord {
  id: string
  objectKey: string
  artifactType: 'redaction_output'
}

export const redactionRunColumns = `run.id, run.organisation_id, run.matter_id, matter.name as matter_name, run.document_id,
  run.document_version_id, run.source_filename, run.source_text_object_key, run.source_file_object_key,
  run.source_layout_object_key, run.source_mime_type, run.status, run.policy_mode,
  run.spans_json, run.decisions_json, run.output_artifact_id, run.summary_json, run.detector_version,
  run.detection_mode, run.replaces_run_id, replacement.id as replacement_run_id, run.created_by, run.created_at, run.updated_at, run.deleted_at, run.deleted_by`
export const redactionRunsFrom = `from redaction_runs run
  left join matters matter on matter.id = run.matter_id and matter.organisation_id = run.organisation_id
  left join redaction_runs replacement on replacement.organisation_id = run.organisation_id
    and replacement.replaces_run_id = run.id and replacement.deleted_at is null`

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}
function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Stored redaction JSON is invalid.')
  }
}

function parseSpans(value: unknown): RedactionSpan[] {
  const parsed = json(value)
  if (!Array.isArray(parsed))
    throw new Error('Stored redaction spans are invalid.')
  return parsed.map((span): RedactionSpan => {
    if (typeof span !== 'object' || span === null)
      throw new Error('Stored redaction span is invalid.')
    const item = span as Record<string, unknown>
    const category = spanCategorySchema.safeParse(item.category)
    const source = spanSourceSchema.safeParse(item.source)
    const confidence = spanConfidenceSchema.safeParse(item.confidence)
    const suggestion = spanSuggestionSchema.safeParse(item.suggestion)
    if (
      !category.success ||
      !source.success ||
      !confidence.success ||
      !suggestion.success ||
      typeof item.id !== 'string' ||
      typeof item.start !== 'number' ||
      typeof item.end !== 'number' ||
      typeof item.text !== 'string'
    ) {
      throw new Error('Stored redaction span is invalid.')
    }
    return {
      id: item.id,
      start: item.start,
      end: item.end,
      text: item.text,
      category: category.data,
      source: source.data,
      confidence: confidence.data,
      suggestion: suggestion.data,
    }
  })
}

function parseDecisions(value: unknown): Decisions {
  const parsed = json(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Stored redaction decisions are invalid.')
  const decisions: Decisions = {}
  for (const [spanId, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null)
      throw new Error('Stored redaction decision is invalid.')
    const item = value as Record<string, unknown>
    const decision = spanDecisionSchema.safeParse(item.decision)
    if (
      !decision.success ||
      typeof item.decidedBy !== 'string' ||
      typeof item.decidedAt !== 'string'
    )
      throw new Error('Stored redaction decision is invalid.')
    decisions[spanId] = {
      decision: decision.data,
      decidedBy: item.decidedBy,
      decidedAt: item.decidedAt,
    }
  }
  return decisions
}

export function mapRedactionRun(row: RedactionRunRow): RedactionRunRecord {
  if (row.replacement_run_id === undefined)
    throw new Error('Stored redaction replacement lineage was not selected.')
  const summary = json(row.summary_json)
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary))
    throw new Error('Stored redaction summary is invalid.')
  return {
    id: row.id,
    organisationId: row.organisation_id,
    matterId: row.matter_id,
    matterName: row.matter_name,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    sourceFilename: row.source_filename,
    sourceTextObjectKey: row.source_text_object_key,
    sourceFileObjectKey: row.source_file_object_key ?? null,
    sourceLayoutObjectKey: row.source_layout_object_key ?? null,
    sourceMimeType: row.source_mime_type ?? null,
    status: row.status,
    policyMode: row.policy_mode,
    spans: parseSpans(row.spans_json),
    decisions: parseDecisions(row.decisions_json),
    outputArtifactId: row.output_artifact_id,
    summary: summary as RedactionRunRecord['summary'],
    detectorVersion: row.detector_version,
    detectionMode: detectionModeSchema.parse(row.detection_mode),
    replacesRunId: row.replaces_run_id ?? null,
    replacementRunId: row.replacement_run_id,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: row.deleted_at ? timestamp(row.deleted_at) : null,
    deletedBy: row.deleted_by,
  }
}

export function computeSummary(
  spans: RedactionSpan[],
  decisions: Decisions,
): RunSummary {
  const byCategory = Object.fromEntries(
    spanCategorySchema.options.map((category) => [category, 0]),
  ) as Record<RedactionSpan['category'], number>
  const bySource = { rampartModel: 0, rampartDeterministic: 0, ukSupplement: 0 }
  const byDecision: Record<SpanDecision | 'undecided', number> = {
    accept: 0,
    reject: 0,
    override_redact: 0,
    override_keep: 0,
    pseudonymise: 0,
    undecided: 0,
  }
  for (const span of spans) {
    byCategory[span.category] += 1
    if (span.source === 'rampart_model') bySource.rampartModel += 1
    if (span.source === 'rampart_deterministic')
      bySource.rampartDeterministic += 1
    if (span.source === 'uk_supplement') bySource.ukSupplement += 1
    byDecision[decisions[span.id]?.decision ?? 'undecided'] += 1
  }
  const reviewedCount = spans.length - byDecision.undecided
  return {
    totalSpans: spans.length,
    byCategory,
    bySource,
    byDecision,
    reviewedCount,
    unreviewedCount: spans.length - reviewedCount,
  }
}

export function publicRun(run: RedactionRunRecord) {
  const { tokenMap: _tokenMap, ...summary } = run.summary
  const {
    sourceTextObjectKey: _sourceTextObjectKey,
    sourceFileObjectKey: _sourceFileObjectKey,
    sourceLayoutObjectKey: _sourceLayoutObjectKey,
    ...publicRecord
  } = run
  const pdfPreview =
    isPdfSource(run.sourceFilename, run.sourceMimeType) &&
    Boolean(run.sourceFileObjectKey || run.documentVersionId)
  return {
    ...publicRecord,
    summary,
    sourcePreview: {
      kind: pdfPreview ? ('pdf' as const) : ('text' as const),
      available: pdfPreview,
    },
  }
}

function isPdfSource(filename: string, mimeType: string | null) {
  if (mimeType?.toLowerCase().includes('pdf')) return true
  return /\.pdf$/i.test(filename)
}

async function selectRedactionRun(
  queryable: Pick<Pool, 'query'>,
  organisationId: string,
  runId: string,
  includeDeleted = false,
) {
  const result = await queryable.query<RedactionRunRow>(
    `select ${redactionRunColumns} ${redactionRunsFrom}
     where run.id = $1 and run.organisation_id = $2
       and ($3::boolean or run.deleted_at is null)`,
    [runId, organisationId, includeDeleted],
  )
  return result.rows[0] ? mapRedactionRun(result.rows[0]) : null
}

export async function getRedactionRun(
  pool: Pool,
  organisationId: string,
  runId: string,
  options: { includeDeleted?: boolean } = {},
) {
  return selectRedactionRun(
    pool,
    organisationId,
    runId,
    options.includeDeleted === true,
  )
}

export async function listRedactionRuns(
  pool: Pool,
  organisationId: string,
  options: { includeDeleted?: boolean } = {},
) {
  const result = await pool.query<RedactionRunRow>(
    `select ${redactionRunColumns} ${redactionRunsFrom}
     where run.organisation_id = $1
       and ($2::boolean or run.deleted_at is null)
     order by run.created_at desc`,
    [organisationId, options.includeDeleted === true],
  )
  return result.rows.map(mapRedactionRun)
}

export async function listRedactionRunsForDocument(
  pool: Pool,
  organisationId: string,
  documentId: string,
  options: { includeDeleted?: boolean } = {},
) {
  const result = await pool.query<RedactionRunRow>(
    `select ${redactionRunColumns} ${redactionRunsFrom}
     where run.document_id = $1 and run.organisation_id = $2
       and ($3::boolean or run.deleted_at is null)
     order by run.created_at desc`,
    [documentId, organisationId, options.includeDeleted === true],
  )
  return result.rows.map(mapRedactionRun)
}

export async function getRunTextObjectKey(pool: Pool, run: RedactionRunRecord) {
  if (run.sourceTextObjectKey) return run.sourceTextObjectKey
  if (!run.documentVersionId) return null
  const result = await pool.query<{ text_object_key: string | null }>(
    'select text_object_key from document_versions where id = $1 and organisation_id = $2',
    [run.documentVersionId, run.organisationId],
  )
  return result.rows[0]?.text_object_key ?? null
}

export async function getRunSourceFile(pool: Pool, run: RedactionRunRecord) {
  if (run.sourceFileObjectKey) {
    return {
      objectKey: run.sourceFileObjectKey,
      mimeType: run.sourceMimeType ?? 'application/octet-stream',
      filename: run.sourceFilename,
    }
  }
  if (!run.documentVersionId) return null
  const result = await pool.query<{
    object_key: string
    filename: string
    file_type: string
  }>(
    `select object_key, filename, file_type
     from document_versions
     where id = $1 and organisation_id = $2`,
    [run.documentVersionId, run.organisationId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    objectKey: row.object_key,
    mimeType: row.file_type || 'application/octet-stream',
    filename: row.filename,
  }
}

export async function getRunLayoutObjectKey(
  pool: Pool,
  run: RedactionRunRecord,
) {
  if (run.sourceLayoutObjectKey) return run.sourceLayoutObjectKey
  if (!run.documentVersionId) return null
  const result = await pool.query<{ object_key: string }>(
    `select object_key from document_versions where id = $1 and organisation_id = $2`,
    [run.documentVersionId, run.organisationId],
  )
  const objectKey = result.rows[0]?.object_key
  if (!objectKey?.endsWith('/source')) return null
  return objectKey.replace(/\/source$/, '/layout.json')
}

export async function getDocumentRedactionSource(
  pool: Pool,
  organisationId: string,
  documentId: string,
) {
  const result = await pool.query<{
    matter_id: string
    version_id: string
    filename: string
    text_object_key: string | null
  }>(
    `
    select document.matter_id, version.id as version_id, version.filename, version.text_object_key
    from matter_documents document
    join document_versions version on version.id = document.current_version_id and version.organisation_id = document.organisation_id
    where document.id = $1 and document.organisation_id = $2 and document.deleted_at is null
  `,
    [documentId, organisationId],
  )
  return result.rows[0] ?? null
}

export async function recordSpanDecision(input: {
  pool: Pool
  organisationId: string
  runId: string
  spanId: string
  decision: SpanDecision
  userId: string
}) {
  const client = await input.pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query<RedactionRunRow>(
      `select ${redactionRunColumns} ${redactionRunsFrom} where run.id = $1 and run.organisation_id = $2 and run.deleted_at is null for update of run`,
      [input.runId, input.organisationId],
    )
    if (!locked.rows[0]) {
      await client.query('rollback')
      return { kind: 'not_found' as const }
    }
    const run = mapRedactionRun(locked.rows[0])
    if (run.status === 'finalized') {
      await client.query('rollback')
      return { kind: 'finalized' as const }
    }
    if (run.replacementRunId) {
      await client.query('rollback')
      return {
        kind: 'replaced' as const,
        replacementRunId: run.replacementRunId,
      }
    }
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing') {
      await client.query('rollback')
      return { kind: 'not_reviewable' as const }
    }
    const span = run.spans.find((item) => item.id === input.spanId)
    if (!span) {
      await client.query('rollback')
      return { kind: 'span_not_found' as const }
    }
    const decisions: Decisions = {
      ...run.decisions,
      [span.id]: {
        decision: input.decision,
        decidedBy: input.userId,
        decidedAt: new Date().toISOString(),
      },
    }
    const summary = computeSummary(run.spans, decisions)
    await client.query(
      `update redaction_runs set status = case when status = 'ready_for_review' then 'reviewing' else status end, decisions_json = $3::jsonb, summary_json = $4::jsonb, updated_at = now() where id = $1 and organisation_id = $2`,
      [
        run.id,
        run.organisationId,
        JSON.stringify(decisions),
        JSON.stringify(summary),
      ],
    )
    const updatedRun = await selectRedactionRun(
      client,
      run.organisationId,
      run.id,
    )
    if (!updatedRun) throw new Error('Updated redaction run could not be read.')
    await client.query('commit')
    return { kind: 'updated' as const, run: updatedRun, span }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function finalizeRedactionRun(input: {
  pool: Pool
  organisationId: string
  runId: string
  outputMode: OutputMode
  tokenMap: TokenMap
  artifactId: string
  userId: string
  requestId: string
  degradedDetectionAcknowledged: boolean
  unknownDetectionAcknowledged: boolean
  outputMimeType?: string
  outputFilename?: string
}) {
  const client = await input.pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query<RedactionRunRow>(
      `select ${redactionRunColumns} ${redactionRunsFrom} where run.id = $1 and run.organisation_id = $2 and run.deleted_at is null for update of run`,
      [input.runId, input.organisationId],
    )
    if (!locked.rows[0]) {
      await client.query('rollback')
      return { kind: 'not_found' as const }
    }
    const run = mapRedactionRun(locked.rows[0])
    if (run.status === 'finalized') {
      await client.query('rollback')
      return { kind: 'already_finalized' as const }
    }
    if (run.replacementRunId) {
      await client.query('rollback')
      return {
        kind: 'replaced' as const,
        replacementRunId: run.replacementRunId,
      }
    }
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing') {
      await client.query('rollback')
      return { kind: 'not_reviewable' as const }
    }
    if (
      (run.detectionMode === 'heuristics+supplement' &&
        !input.degradedDetectionAcknowledged) ||
      (run.detectionMode === 'unknown' && !input.unknownDetectionAcknowledged)
    ) {
      await client.query('rollback')
      return { kind: 'acknowledgement_required' as const }
    }
    const objectKey = run.matterId
      ? `org/${run.organisationId}/matters/${run.matterId}/artifacts/${input.artifactId}`
      : `org/${run.organisationId}/artifacts/${input.artifactId}`
    const artifact = await client.query<{ id: string; object_key: string }>(
      `insert into artifacts (id, organisation_id, matter_id, document_id, document_version_id, artifact_type, status, object_key, created_by, created_at, updated_at) values ($1, $2, $3, $4, $5, 'redaction_output', 'ready', $6, $7, now(), now()) returning id, object_key`,
      [
        input.artifactId,
        run.organisationId,
        run.matterId,
        run.documentId,
        run.documentVersionId,
        objectKey,
        run.createdBy,
      ],
    )
    const summary = {
      ...computeSummary(run.spans, run.decisions),
      tokenMap: input.tokenMap,
      outputMode: input.outputMode,
      outputMimeType: input.outputMimeType ?? 'text/plain',
      outputFilename: input.outputFilename ?? null,
    }
    await client.query(
      `update redaction_runs set status = 'finalized', output_artifact_id = $3, summary_json = $4::jsonb, updated_at = now() where id = $1 and organisation_id = $2`,
      [run.id, run.organisationId, input.artifactId, JSON.stringify(summary)],
    )
    const finalizedRun = await selectRedactionRun(
      client,
      run.organisationId,
      run.id,
    )
    if (!finalizedRun)
      throw new Error('Finalized redaction run could not be read.')
    const unreviewedSpanIds = finalizedRun.spans
      .filter((span) => !finalizedRun.decisions[span.id])
      .map((span) => span.id)
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'redaction_run',
      entityId: finalizedRun.id,
      action: 'redaction.finalize',
      metadata: {
        outputMode: input.outputMode,
        outputMimeType: input.outputMimeType ?? 'text/plain',
        outputFilename: input.outputFilename ?? null,
        detectionMode: finalizedRun.detectionMode,
        degradedDetectionAcknowledged:
          finalizedRun.detectionMode === 'heuristics+supplement' &&
          input.degradedDetectionAcknowledged === true,
        unknownDetectionAcknowledged:
          finalizedRun.detectionMode === 'unknown' &&
          input.unknownDetectionAcknowledged === true,
        artifactId: artifact.rows[0].id,
        spanCount: finalizedRun.summary.totalSpans,
        reviewedCount: finalizedRun.summary.reviewedCount,
        unreviewedCount: finalizedRun.summary.unreviewedCount,
        unreviewedSpanIds: unreviewedSpanIds.slice(
          0,
          MAX_FINALIZE_AUDIT_SPAN_IDS,
        ),
        unreviewedSpanIdsTruncated:
          unreviewedSpanIds.length > MAX_FINALIZE_AUDIT_SPAN_IDS,
      },
      requestId: input.requestId,
    })
    await client.query('commit')
    return {
      kind: 'finalized' as const,
      run: finalizedRun,
      artifact: {
        id: artifact.rows[0].id,
        objectKey: artifact.rows[0].object_key,
        artifactType: 'redaction_output' as const,
      } satisfies ArtifactRecord,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export interface RedactionAuditLogEntry {
  action: string
  userId: string | null
  timestamp: string
  details: Record<string, unknown>
}

export async function listRedactionAuditLog(
  pool: Pool,
  organisationId: string,
  runId: string,
): Promise<RedactionAuditLogEntry[]> {
  // organisation_id is deliberately part of the predicate: nullable auth rows
  // (migration 0009) cannot leak into an organisation-scoped run report.
  const result = await pool.query<{
    action: string
    user_id: string | null
    created_at: Date | string
    metadata_json: unknown
  }>(
    `select action, user_id, created_at, metadata_json
     from audit_logs
     where organisation_id = $1 and entity_type = 'redaction_run' and entity_id = $2
     order by created_at asc`,
    [organisationId, runId],
  )
  return result.rows.map((row) => ({
    action: row.action,
    userId: row.user_id,
    timestamp: timestamp(row.created_at),
    details: (json(row.metadata_json) as Record<string, unknown>) ?? {},
  }))
}

export async function getRedactionOutputKey(
  pool: Pool,
  organisationId: string,
  artifactId: string,
) {
  const result = await pool.query<{ object_key: string }>(
    "select object_key from artifacts where id = $1 and organisation_id = $2 and artifact_type = 'redaction_output' and status = 'ready'",
    [artifactId, organisationId],
  )
  return result.rows[0]?.object_key ?? null
}

/**
 * Soft-deletes a standalone redaction run and writes the audit event in one
 * transaction. Returns null when the run is missing, cross-org, or already
 * deleted (caller surfaces 404 without auditing). Cascade deletes from a
 * matter or document use the same columns via database.ts and do not call this.
 */
export async function softDeleteRedactionRun(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    runId: string
    requestId: string
  },
): Promise<RedactionRunRecord | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const lock = await client.query<{ id: string }>(
      `select id from redaction_runs
       where id = $1 and organisation_id = $2 and deleted_at is null
       for update`,
      [input.runId, input.organisationId],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    await client.query(
      `update redaction_runs
       set deleted_at = now(), deleted_by = $3, updated_at = now()
       where id = $1 and organisation_id = $2 and deleted_at is null`,
      [input.runId, input.organisationId, input.userId],
    )
    const run = await selectRedactionRun(
      client,
      input.organisationId,
      input.runId,
      true,
    )
    if (!run) throw new Error('Deleted redaction run could not be read.')

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction_run.delete',
      metadata: {},
      requestId: input.requestId,
    })

    await client.query('commit')
    return run
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/** Restores one run after parent-liveness checks; intentionally not yet routed. */
export async function restoreRedactionRunWithAudit(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    runId: string
    requestId: string
  },
) {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const candidate = await client.query<{
      matter_id: string | null
      document_id: string | null
      replaces_run_id: string | null
    }>(
      `select matter_id, document_id, replaces_run_id from redaction_runs
       where id = $1 and organisation_id = $2 and deleted_at is not null`,
      [input.runId, input.organisationId],
    )
    if (candidate.rows.length === 0) {
      await client.query('rollback')
      return { kind: 'not_found' as const }
    }

    const parent = candidate.rows[0]
    // Lock the run being restored, then its source run, then the matter and
    // document. Re-detection locks the source run before the same parents, so
    // sharing that order keeps the two paths from deadlocking on each other.
    const lock = await client.query<{ deleted_at: string }>(
      `select deleted_at::text from redaction_runs
       where id = $1
         and organisation_id = $2
         and deleted_at is not null
         and matter_id is not distinct from $3
         and document_id is not distinct from $4
       for update`,
      [input.runId, input.organisationId, parent.matter_id, parent.document_id],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return { kind: 'not_found' as const }
    }
    const cascadeTimestamp = lock.rows[0].deleted_at

    if (parent.replaces_run_id) {
      // Hold the source run so a concurrent re-detection cannot install a
      // competing replacement between this check and the update below.
      await client.query(
        `select id from redaction_runs
         where id = $1 and organisation_id = $2
         for update`,
        [parent.replaces_run_id, input.organisationId],
      )
      const competing = await client.query<{ id: string }>(
        `select id from redaction_runs
         where organisation_id = $1
           and replaces_run_id = $2
           and deleted_at is null
           and id <> $3`,
        [input.organisationId, parent.replaces_run_id, input.runId],
      )
      if (competing.rows[0]) {
        await client.query('rollback')
        return {
          kind: 'replacement_exists' as const,
          sourceRunId: parent.replaces_run_id,
          replacementRunId: competing.rows[0].id,
        }
      }
    }

    if (parent.matter_id) {
      const matter = await client.query<{ id: string }>(
        `select id from matters
         where id = $1 and organisation_id = $2 and deleted_at is null
         for update`,
        [parent.matter_id, input.organisationId],
      )
      if (matter.rows.length === 0) {
        await client.query('rollback')
        return { kind: 'not_found' as const }
      }
    }
    if (parent.document_id) {
      const document = await client.query<{ id: string }>(
        `select id from matter_documents
         where id = $1
           and organisation_id = $2
           and matter_id = $3
           and deleted_at is null
         for update`,
        [parent.document_id, input.organisationId, parent.matter_id],
      )
      if (document.rows.length === 0) {
        await client.query('rollback')
        return { kind: 'not_found' as const }
      }
    }

    await client.query(
      `update redaction_runs
       set deleted_at = null, deleted_by = null, updated_at = now()
       where id = $1
         and organisation_id = $2
         and deleted_at = $3::timestamptz`,
      [input.runId, input.organisationId, cascadeTimestamp],
    )
    const run = await selectRedactionRun(
      client,
      input.organisationId,
      input.runId,
    )
    if (!run) throw new Error('Restored redaction run could not be read.')

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction_run.restore',
      metadata: { replacesRunId: run.replacesRunId },
      requestId: input.requestId,
    })

    await client.query('commit')
    return { kind: 'restored' as const, run }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
