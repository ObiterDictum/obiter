import type { Pool, PoolClient } from 'pg'
import {
  verificationFindingSchema,
  type VerificationFinding,
} from '@obiter/verification-core'
import { matterAccessPredicate } from './matter-access-boundary'
import { toPublicRun, type VerificationRunRow } from './verification-present'
import type { AuthenticatedOrgUser } from './authz'
import type { VerificationFailureCode } from '@obiter/contracts'
import {
  cursorFromRow,
  encodeVerificationCursor,
  findingCursorFromRow,
  type VerificationPageCursor,
} from './verification-pagination'

type Queryable = Pick<Pool, 'query'>
type AccessLevel = 'view' | 'edit'

const verificationRunLeaseSeconds = 600

const runColumns = `
  run.id, run.organisation_id, run.matter_id, run.document_id,
  run.document_version_id, run.status, run.failure_code, run.created_by,
  run.created_at, run.started_at, run.completed_at,
  to_char(run.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    as cursor_created_at,
  document.current_version_id as document_current_version_id,
  coalesce(stats.finding_count, 0) as finding_count,
  coalesce(stats.flagged_count, 0) as flagged_count,
  coalesce(stats.review_required_count, 0) as review_required_count,
  coalesce(stats.not_checked_count, 0) as not_checked_count,
  coalesce(stats.dismissed_count, 0) as dismissed_count
`

type RunCursorRow = VerificationRunRow & { cursor_created_at: string }

const runFrom = `
  from verification_runs run
  join matters matter
    on matter.id = run.matter_id
   and matter.organisation_id = run.organisation_id
  join matter_documents document
    on document.id = run.document_id
   and document.matter_id = run.matter_id
   and document.organisation_id = run.organisation_id
  left join lateral (
    select count(*)::int as finding_count,
      count(*) filter (
        where finding.status_state = 'flagged' and dismissal.run_id is null
      )::int as flagged_count,
      count(*) filter (
        where finding.status_state = 'review_required'
          and dismissal.run_id is null
      )::int as review_required_count,
      count(*) filter (
        where finding.status_state = 'not_checked'
          and dismissal.run_id is null
      )::int as not_checked_count,
      count(*) filter (where dismissal.run_id is not null)::int
        as dismissed_count
    from verification_findings finding
    left join verification_finding_dismissals dismissal
      on dismissal.run_id = finding.run_id
     and dismissal.finding_id = finding.finding_id
    where finding.run_id = run.id
      and finding.organisation_id = run.organisation_id
  ) stats on true
`

function liveRunPredicate(access: AccessLevel, userParameter: '$2' | '$3') {
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

export type VerificationRunPage = {
  runs: ReturnType<typeof toPublicRun>[]
  nextCursor: string | null
}

export async function listVerificationRuns(
  queryable: Queryable,
  user: AuthenticatedOrgUser,
  input: {
    documentId?: string
    limit: number
    cursor: VerificationPageCursor | null
  },
): Promise<VerificationRunPage> {
  const values: unknown[] = [user.organisationId, user.id]
  const clauses = [`run.organisation_id = $1`, liveRunPredicate('view', '$2')]
  if (input.documentId !== undefined) {
    values.push(input.documentId)
    clauses.push(`run.document_id = $${values.length}`)
  }
  if (input.cursor) {
    values.push(input.cursor.createdAt, input.cursor.id)
    clauses.push(
      `(run.created_at, run.id) < ($${values.length - 1}::timestamptz, $${values.length})`,
    )
  }
  values.push(input.limit + 1)
  const result = await queryable.query<RunCursorRow>(
    `select ${runColumns} ${runFrom}
     where ${clauses.join(' and ')}
     order by run.created_at desc, run.id desc
     limit $${values.length}`,
    values,
  )
  const hasNext = result.rows.length > input.limit
  const rows = hasNext ? result.rows.slice(0, input.limit) : result.rows
  const last = rows.at(-1)
  return {
    runs: rows.map(toPublicRun),
    nextCursor:
      hasNext && last ? encodeVerificationCursor(cursorFromRow(last)) : null,
  }
}

type StoredFindingDismissal = {
  reason: string | null
  dismissedBy: string
  dismissedAt: string
}

export type VerificationFindingPage = {
  findings: VerificationFinding[]
  dismissals: Map<string, StoredFindingDismissal>
  nextCursor: string | null
}

export async function listVerificationFindings(
  queryable: Queryable,
  user: AuthenticatedOrgUser,
  runId: string,
  input: { limit: number; cursor: VerificationPageCursor | null },
): Promise<VerificationFindingPage> {
  const values: unknown[] = [runId, user.organisationId, user.id]
  const cursorClause = input.cursor
    ? (() => {
        values.push(input.cursor!.createdAt, input.cursor!.id)
        return `and (finding.created_at, finding.finding_id) > ($${values.length - 1}::timestamptz, $${values.length})`
      })()
    : ''
  values.push(input.limit + 1)
  const result = await queryable.query<{
    payload_json: unknown
    finding_id: string
    cursor_created_at: string
    dismissal_reason: string | null
    dismissed_by: string | null
    dismissed_at: string | null
  }>(
    `select finding.payload_json, finding.finding_id,
            to_char(
              finding.created_at at time zone 'utc',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) as cursor_created_at,
            dismissal.reason as dismissal_reason,
            dismissal.dismissed_by,
            case when dismissal.dismissed_at is null then null else
              to_char(
                dismissal.dismissed_at at time zone 'utc',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              )
            end as dismissed_at
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
     left join verification_finding_dismissals dismissal
       on dismissal.run_id = finding.run_id
      and dismissal.finding_id = finding.finding_id
     where finding.run_id = $1
       and finding.organisation_id = $2
       and run.deleted_at is null
       and matter.deleted_at is null
       and document.deleted_at is null
       and ${matterAccessPredicate('$3', "'view'")}
       ${cursorClause}
     order by finding.created_at, finding.finding_id
     limit $${values.length}`,
    values,
  )
  const hasNext = result.rows.length > input.limit
  const rows = hasNext ? result.rows.slice(0, input.limit) : result.rows
  const last = rows.at(-1)
  const dismissals = new Map<string, StoredFindingDismissal>()
  for (const row of rows) {
    if (!row.dismissed_by || !row.dismissed_at) continue
    dismissals.set(row.finding_id, {
      reason: row.dismissal_reason,
      dismissedBy: row.dismissed_by,
      dismissedAt: row.dismissed_at,
    })
  }
  return {
    findings: rows.map((row) =>
      verificationFindingSchema.parse(row.payload_json),
    ),
    dismissals,
    nextCursor:
      hasNext && last
        ? encodeVerificationCursor(findingCursorFromRow(last))
        : null,
  }
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
       where deleted_at is null and status in ('queued', 'running')
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

export type LiveVerificationRun = {
  id: string
  status: 'queued' | 'running'
  started_at: Date | null
  lease_expires_at: Date | null
  lease_token: string | null
}

export async function lockLiveVerificationRunForVersion(
  client: PoolClient,
  input: {
    organisationId: string
    documentId: string
    documentVersionId: string
  },
): Promise<LiveVerificationRun | null> {
  const result = await client.query<LiveVerificationRun>(
    `select id, status, started_at, lease_expires_at, lease_token
     from verification_runs
     where organisation_id = $1
       and document_id = $2
       and document_version_id = $3
       and deleted_at is null
       and status in ('queued', 'running')
     for update`,
    [input.organisationId, input.documentId, input.documentVersionId],
  )
  return result.rows[0] ?? null
}

export function leaseIsLive(
  run: Pick<LiveVerificationRun, 'lease_expires_at'>,
  now: Date = new Date(),
) {
  if (run.lease_expires_at == null) return false
  return new Date(run.lease_expires_at).getTime() > now.getTime()
}

export async function markVerificationRunRunning(
  client: PoolClient,
  organisationId: string,
  runId: string,
  leaseToken: string,
) {
  await client.query(
    `update verification_runs
     set status = 'running',
         started_at = coalesce(started_at, now()),
         failure_code = null,
         completed_at = null,
         lease_token = $3,
         lease_expires_at = now() + make_interval(secs => $4)
     where id = $1
       and organisation_id = $2
       and deleted_at is null
       and status in ('queued', 'running')`,
    [runId, organisationId, leaseToken, verificationRunLeaseSeconds],
  )
}

export async function renewVerificationRunLease(
  pool: Pick<Pool, 'query'>,
  input: { organisationId: string; runId: string; leaseToken: string },
) {
  await pool.query(
    `update verification_runs
     set lease_expires_at = now() + make_interval(secs => $4)
     where id = $1
       and organisation_id = $2
       and lease_token = $3
       and status = 'running'
       and deleted_at is null`,
    [
      input.runId,
      input.organisationId,
      input.leaseToken,
      verificationRunLeaseSeconds,
    ],
  )
}

export async function interruptVerificationRun(
  client: PoolClient,
  input: { organisationId: string; runId: string },
) {
  const result = await client.query(
    `update verification_runs
     set status = 'failed',
         failure_code = 'interrupted',
         completed_at = now(),
         lease_token = null,
         lease_expires_at = null
     where id = $1
       and organisation_id = $2
       and status in ('queued', 'running')
       and deleted_at is null`,
    [input.runId, input.organisationId],
  )
  await client.query(
    `delete from verification_findings
     where run_id = $1 and organisation_id = $2`,
    [input.runId, input.organisationId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function completeVerificationRun(
  client: PoolClient,
  input: {
    organisationId: string
    runId: string
    status: 'completed' | 'failed'
    failureCode: VerificationFailureCode | null
    leaseToken: string
  },
): Promise<boolean> {
  const result = await client.query(
    `update verification_runs
     set status = $3,
         failure_code = $4,
         completed_at = now(),
         lease_token = null,
         lease_expires_at = null
     where id = $1
       and organisation_id = $2
       and lease_token = $5
       and status = 'running'
       and deleted_at is null`,
    [
      input.runId,
      input.organisationId,
      input.status,
      input.failureCode,
      input.leaseToken,
    ],
  )
  return (result.rowCount ?? 0) > 0
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
      finding.status.state === 'review_required' ? finding.status.reason : null
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
