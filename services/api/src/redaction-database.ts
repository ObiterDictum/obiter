import type { Pool, PoolClient } from 'pg'
import type {
  OutputMode,
  RedactionPolicyMode,
  RedactionRunStatus,
  SpanDecision,
} from '@obiter/contracts'
import type { Decisions, RedactionSpan, RunSummary, TokenMap } from '@obiter/redaction-policy'
import { spanCategorySchema, spanConfidenceSchema, spanDecisionSchema, spanSourceSchema, spanSuggestionSchema } from '@obiter/contracts'

export interface RedactionRunRecord {
  id: string
  organisationId: string
  matterId: string
  documentId: string
  documentVersionId: string
  status: RedactionRunStatus
  policyMode: RedactionPolicyMode
  spans: RedactionSpan[]
  decisions: Decisions
  outputArtifactId: string | null
  summary: RunSummary & { tokenMap?: TokenMap; outputMode?: OutputMode }
  detectorVersion: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface RedactionRunRow {
  id: string; organisation_id: string; matter_id: string; document_id: string; document_version_id: string
  status: RedactionRunStatus; policy_mode: RedactionPolicyMode; spans_json: unknown; decisions_json: unknown
  output_artifact_id: string | null; summary_json: unknown; detector_version: string | null; created_by: string
  created_at: Date | string; updated_at: Date | string
}

interface ArtifactRecord {
  id: string
  objectKey: string
  artifactType: 'redaction_output'
}

function timestamp(value: Date | string) { return value instanceof Date ? value.toISOString() : value }
function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { throw new Error('Stored redaction JSON is invalid.') }
}

function parseSpans(value: unknown): RedactionSpan[] {
  const parsed = json(value)
  if (!Array.isArray(parsed)) throw new Error('Stored redaction spans are invalid.')
  return parsed.map((span): RedactionSpan => {
    if (typeof span !== 'object' || span === null) throw new Error('Stored redaction span is invalid.')
    const item = span as Record<string, unknown>
    const category = spanCategorySchema.safeParse(item.category)
    const source = spanSourceSchema.safeParse(item.source)
    const confidence = spanConfidenceSchema.safeParse(item.confidence)
    const suggestion = spanSuggestionSchema.safeParse(item.suggestion)
    if (!category.success || !source.success || !confidence.success || !suggestion.success
      || typeof item.id !== 'string' || typeof item.start !== 'number' || typeof item.end !== 'number' || typeof item.text !== 'string') {
      throw new Error('Stored redaction span is invalid.')
    }
    return { id: item.id, start: item.start, end: item.end, text: item.text, category: category.data, source: source.data, confidence: confidence.data, suggestion: suggestion.data }
  })
}

function parseDecisions(value: unknown): Decisions {
  const parsed = json(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Stored redaction decisions are invalid.')
  const decisions: Decisions = {}
  for (const [spanId, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null) throw new Error('Stored redaction decision is invalid.')
    const decision = spanDecisionSchema.safeParse((value as Record<string, unknown>).decision)
    const decidedBy = (value as Record<string, unknown>).decidedBy
    const decidedAt = (value as Record<string, unknown>).decidedAt
    if (!decision.success || typeof decidedBy !== 'string' || typeof decidedAt !== 'string') throw new Error('Stored redaction decision is invalid.')
    decisions[spanId] = { decision: decision.data, decidedBy, decidedAt }
  }
  return decisions
}

function parseSummary(value: unknown): RedactionRunRecord['summary'] {
  const summary = json(value)
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) throw new Error('Stored redaction summary is invalid.')
  return summary as RedactionRunRecord['summary']
}

function mapRun(row: RedactionRunRow): RedactionRunRecord {
  return {
    id: row.id, organisationId: row.organisation_id, matterId: row.matter_id, documentId: row.document_id,
    documentVersionId: row.document_version_id, status: row.status, policyMode: row.policy_mode,
    spans: parseSpans(row.spans_json), decisions: parseDecisions(row.decisions_json), outputArtifactId: row.output_artifact_id,
    summary: parseSummary(row.summary_json), detectorVersion: row.detector_version, createdBy: row.created_by,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
  }
}

const columns = `id, organisation_id, matter_id, document_id, document_version_id, status, policy_mode,
  spans_json, decisions_json, output_artifact_id, summary_json, detector_version, created_by, created_at, updated_at`

type Queryable = Pick<Pool | PoolClient, 'query'>

export function computeSummary(spans: RedactionSpan[], decisions: Decisions): RunSummary {
  const byCategory = Object.fromEntries(spanCategorySchema.options.map((category) => [category, 0])) as Record<RedactionSpan['category'], number>
  const bySource = { rampartModel: 0, rampartDeterministic: 0, ukSupplement: 0 }
  const byDecision: Record<SpanDecision | 'undecided', number> = { accept: 0, reject: 0, override_redact: 0, override_keep: 0, pseudonymise: 0, undecided: 0 }
  for (const span of spans) {
    byCategory[span.category] += 1
    if (span.source === 'rampart_model') bySource.rampartModel += 1
    if (span.source === 'rampart_deterministic') bySource.rampartDeterministic += 1
    if (span.source === 'uk_supplement') bySource.ukSupplement += 1
    byDecision[decisions[span.id]?.decision ?? 'undecided'] += 1
  }
  const reviewedCount = spans.length - byDecision.undecided
  return { totalSpans: spans.length, byCategory, bySource, byDecision, reviewedCount, unreviewedCount: spans.length - reviewedCount }
}

export function publicRun(run: RedactionRunRecord) {
  const { tokenMap: _tokenMap, ...summary } = run.summary
  return { ...run, summary }
}

export async function getRedactionRun(pool: Pool, organisationId: string, runId: string) {
  const result = await pool.query<RedactionRunRow>(`select ${columns} from redaction_runs where id = $1 and organisation_id = $2`, [runId, organisationId])
  return result.rows[0] ? mapRun(result.rows[0]) : null
}

export async function listRedactionRunsForDocument(pool: Pool, organisationId: string, documentId: string) {
  const result = await pool.query<RedactionRunRow>(`select ${columns} from redaction_runs where document_id = $1 and organisation_id = $2 order by created_at desc`, [documentId, organisationId])
  return result.rows.map(mapRun)
}

export async function getRunDocumentTextKey(pool: Pool, run: RedactionRunRecord) {
  const result = await pool.query<{ text_object_key: string | null }>(`select text_object_key from document_versions where id = $1 and organisation_id = $2`, [run.documentVersionId, run.organisationId])
  return result.rows[0]?.text_object_key ?? null
}

export async function recordSpanDecision(input: { pool: Pool; organisationId: string; runId: string; spanId: string; decision: SpanDecision; userId: string }) {
  const client = await input.pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query<RedactionRunRow>(`select ${columns} from redaction_runs where id = $1 and organisation_id = $2 for update`, [input.runId, input.organisationId])
    if (!locked.rows[0]) { await client.query('rollback'); return { kind: 'not_found' as const } }
    const run = mapRun(locked.rows[0])
    if (run.status === 'finalized') { await client.query('rollback'); return { kind: 'finalized' as const } }
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing') { await client.query('rollback'); return { kind: 'not_reviewable' as const } }
    const span = run.spans.find((item) => item.id === input.spanId)
    if (!span) { await client.query('rollback'); return { kind: 'span_not_found' as const } }
    const decisions: Decisions = { ...run.decisions, [span.id]: { decision: input.decision, decidedBy: input.userId, decidedAt: new Date().toISOString() } }
    const summary = computeSummary(run.spans, decisions)
    const updated = await client.query<RedactionRunRow>(`update redaction_runs set status = case when status = 'ready_for_review' then 'reviewing' else status end, decisions_json = $3::jsonb, summary_json = $4::jsonb, updated_at = now() where id = $1 and organisation_id = $2 returning ${columns}`, [run.id, run.organisationId, JSON.stringify(decisions), JSON.stringify(summary)])
    await client.query('commit')
    return { kind: 'updated' as const, run: mapRun(updated.rows[0]), span }
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}

export async function finalizeRedactionRun(input: { pool: Pool; organisationId: string; runId: string; outputMode: OutputMode; tokenMap: TokenMap; artifactId: string }) {
  const client = await input.pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query<RedactionRunRow>(`select ${columns} from redaction_runs where id = $1 and organisation_id = $2 for update`, [input.runId, input.organisationId])
    if (!locked.rows[0]) { await client.query('rollback'); return { kind: 'not_found' as const } }
    const run = mapRun(locked.rows[0])
    if (run.status === 'finalized') { await client.query('rollback'); return { kind: 'already_finalized' as const } }
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing') { await client.query('rollback'); return { kind: 'not_reviewable' as const } }
    const objectKey = `org/${run.organisationId}/matters/${run.matterId}/artifacts/${input.artifactId}`
    const artifact = await client.query<{ id: string; object_key: string }>(`insert into artifacts (id, organisation_id, matter_id, document_id, document_version_id, artifact_type, status, object_key, created_by, created_at, updated_at) values ($1, $2, $3, $4, $5, 'redaction_output', 'ready', $6, $7, now(), now()) returning id, object_key`, [input.artifactId, run.organisationId, run.matterId, run.documentId, run.documentVersionId, objectKey, run.createdBy])
    const summary = { ...computeSummary(run.spans, run.decisions), tokenMap: input.tokenMap, outputMode: input.outputMode }
    const updated = await client.query<RedactionRunRow>(`update redaction_runs set status = 'finalized', output_artifact_id = $3, summary_json = $4::jsonb, updated_at = now() where id = $1 and organisation_id = $2 returning ${columns}`, [run.id, run.organisationId, input.artifactId, JSON.stringify(summary)])
    await client.query('commit')
    return { kind: 'finalized' as const, run: mapRun(updated.rows[0]), artifact: { id: artifact.rows[0].id, objectKey: artifact.rows[0].object_key, artifactType: 'redaction_output' as const } satisfies ArtifactRecord }
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}
