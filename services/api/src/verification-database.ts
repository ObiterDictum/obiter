import type { Pool, PoolClient } from 'pg'
import {
  verificationFindingSchema,
  type VerificationFinding,
} from '@obiter/verification-core'
import { matterAccessPredicate } from './matter-access-boundary'
import {
  toPublicRun,
  type VerificationRunRow,
} from './verification-present'
import type { AuthenticatedOrgUser } from './authz'
import type { VerificationFailureCode } from '@obiter/contracts'

type Queryable = Pick<Pool, 'query'>
type AccessLevel = 'view' | 'edit'

const runColumns = `
  run.id, run.organisation_id, run.matter_id, run.document_id,
  run.document_version_id, run.status, run.failure_code, run.created_by,
  run.created_at, run.started_at, run.completed_at,
  document.current_version_id as document_current_version_id,
  coalesce(stats.finding_count, 0) as finding_count,
  coalesce(stats.flagged_count, 0) as flagged_count,
  coalesce(stats.review_required_count, 0) as review_required_count
`

const runFrom = `
  from verification_runs run
  join matters matter
    on matter.id = run.matter_id
   and matter.organisation_id = run.organisation_id
  join matter_documents document
    on document.id = run.document_id
   and document.matter_id = run.matter_id
   and document.organisation_id = run.organisation_id
  left join (
    select run_id,
      organisation_id,
      count(*)::int as finding_count,
      count(*) filter (where status_state = 'flagged')::int as flagged_count,
      count(*) filter (
        where status_state in ('review_required', 'not_checked')
      )::int as review_required_count
    from verification_findings
    group by run_id, organisation_id
  ) stats
    on stats.run_id = run.id
   and stats.organisation_id = run.organisation_id
`

function liveRunPredicate(access: AccessLevel, userParameter: '$3' | '$4') {
  const required = access === 'edit' ? "'edit'" : "'view'"
  return `
    run.deleted_at is null
    and matter.deleted_at is null
    and document.deleted_at is null
    and ${matterAccessPredicate(userParameter, required)}
  `
}

export async function getVerificationRun(
  queryable: Queryable,
  user: AuthenticatedOrgUser,
  runId: string,
  access: AccessLevel = 'view',
) {
  const result = await queryable.query<VerificationRunRow>(
    `select ${runColumns} ${runFrom}
     where run.id = $1
       and run.organisation_id = $2
       and ${liveRunPredicate(access, '$3')}`,
    [runId, user.organisationId, user.id],
  )
  const row = result.rows[0]
  return row ? toPublicRun(row) : null
}

export async function listVerificationRuns(
  queryable: Queryable,
  user: AuthenticatedOrgUser,
  documentId?: string,
) {
  const result = await queryable.query<VerificationRunRow>(
    `select ${runColumns} ${runFrom}
     where run.organisation_id = $1
       and ${liveRunPredicate('view', '$2')}
       ${documentId ? 'and run.document_id = $3' : ''}
     order by run.created_at desc`,
    documentId
      ? [user.organisationId, user.id, documentId]
      : [user.organisationId, user.id],
  )
  return result.rows.map(toPublicRun)
}

export async function listVerificationFindings(
  queryable: Queryable,
  user: AuthenticatedOrgUser,
  runId: string,
) {
  const result = await queryable.query<{ payload_json: unknown }>(
    `select finding.payload_json
     from verification_findings finding
     join verification_runs run
       on run.id = finding.run_id
      and run.organisation_id = finding.organisation_id
     join matters matter
       on matter.id = run.matter_id
      and matter.organisation_id = run.organisation_id
     join matter_documents document
       on document.id = run.document_id
      and document.matter_id = run.matter_id
      and document.organisation_id = run.organisation_id
     where finding.run_id = $1
       and finding.organisation_id = $2
       and run.deleted_at is null
       and matter.deleted_at is null
       and document.deleted_at is null
       and ${matterAccessPredicate('$3', "'view'")}
     order by finding.created_at, finding.finding_id`,
    [runId, user.organisationId, user.id],
  )
  return result.rows.map((row) =>
    verificationFindingSchema.parse(row.payload_json),
  )
}

export async function insertVerificationRun(
  client: PoolClient,
  input: {
    id: string
    organisationId: string
    matterId: string
    documentId: string
    documentVersionId: string
    createdBy: string
  },
) {
  const result = await client.query<{ id: string }>(
    `insert into verification_runs (
       id, organisation_id, matter_id, document_id, document_version_id,
       status, created_by, created_at
     ) values ($1, $2, $3, $4, $5, 'queued', $6, now())
     on conflict (organisation_id, document_id, document_version_id)
       where deleted_at is null
     do nothing
     returning id`,
    [
      input.id,
      input.organisationId,
      input.matterId,
      input.documentId,
      input.documentVersionId,
      input.createdBy,
    ],
  )
  return result.rows[0]?.id ?? null
}

export async function lockVerificationRunForVersion(
  client: PoolClient,
  input: {
    organisationId: string
    documentId: string
    documentVersionId: string
  },
) {
  const result = await client.query<{ id: string; status: string }>(
    `select id, status from verification_runs
     where organisation_id = $1
       and document_id = $2
       and document_version_id = $3
       and deleted_at is null
     for update`,
    [input.organisationId, input.documentId, input.documentVersionId],
  )
  return result.rows[0] ?? null
}

export async function markVerificationRunRunning(
  client: PoolClient,
  organisationId: string,
  runId: string,
) {
  await client.query(
    `update verification_runs
     set status = 'running',
         started_at = coalesce(started_at, now()),
         failure_code = null,
         completed_at = null
     where id = $1 and organisation_id = $2 and deleted_at is null`,
    [runId, organisationId],
  )
}

export async function completeVerificationRun(
  client: PoolClient,
  input: {
    organisationId: string
    runId: string
    status: 'completed' | 'failed'
    failureCode: VerificationFailureCode | null
  },
) {
  await client.query(
    `update verification_runs
     set status = $3,
         failure_code = $4,
         completed_at = now()
     where id = $1 and organisation_id = $2 and deleted_at is null`,
    [input.runId, input.organisationId, input.status, input.failureCode],
  )
}

export async function replaceVerificationFindings(
  client: PoolClient,
  organisationId: string,
  runId: string,
  findings: VerificationFinding[],
) {
  await client.query(
    `delete from verification_findings
     where run_id = $1 and organisation_id = $2`,
    [runId, organisationId],
  )
  for (const finding of findings) {
    const statusReason =
      finding.status.state === 'review_required'
        ? finding.status.reason
        : null
    await client.query(
      `insert into verification_findings (
         run_id, finding_id, organisation_id, finding_type, status_state,
         status_reason, severity, confidence, payload_json, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
       on conflict (run_id, finding_id) do update set
         finding_type = excluded.finding_type,
         status_state = excluded.status_state,
         status_reason = excluded.status_reason,
         severity = excluded.severity,
         confidence = excluded.confidence,
         payload_json = excluded.payload_json`,
      [
        runId,
        finding.id,
        organisationId,
        finding.type,
        finding.status.state,
        statusReason,
        finding.severity,
        finding.confidence,
        JSON.stringify(finding),
      ],
    )
  }
}
