import type { Pool } from 'pg'
import type { AuthenticatedOrgUser } from './authz'
import { reviewerNames } from './reviewer-names'
import { getVerificationRun } from './verification-database'

export type DismissFindingOutcome =
  | {
      ok: true
      dismissal: {
        reason: string | null
        dismissedBy: string
        dismissedByName: string | null
        dismissedAt: string
      }
    }
  | {
      ok: false
      reason: 'run_not_found' | 'finding_not_found' | 'finding_not_dismissable'
    }

export type UndismissFindingOutcome =
  { ok: true; removed: boolean } | { ok: false; reason: 'run_not_found' }

/** Everyone in the matter may see who decided, by name rather than by id. */
async function dismissalName(
  queryable: Pick<Pool, 'query'>,
  organisationId: string,
  userId: string,
) {
  return (await reviewerNames(queryable, organisationId, [userId])).get(userId)
}

/**
 * Dismiss one stored finding, or replace an existing dismissal's reason. The
 * check's own outcome is untouched: a dismissal is a person's recorded decision
 * that this finding needs no further action. Editing the matter is required,
 * because the row claims who decided and when for everyone in the matter.
 */
export async function dismissVerificationFinding(
  queryable: Pick<Pool, 'query'>,
  user: AuthenticatedOrgUser,
  input: { runId: string; findingId: string; reason: string | null },
): Promise<DismissFindingOutcome> {
  const run = await getVerificationRun(queryable, user, input.runId, 'edit')
  if (!run) return { ok: false, reason: 'run_not_found' }
  const finding = await queryable.query<{ status_state: string }>(
    `select status_state
     from verification_findings
     where run_id = $1 and organisation_id = $2 and finding_id = $3`,
    [input.runId, user.organisationId, input.findingId],
  )
  const state = finding.rows[0]?.status_state
  if (!state) return { ok: false, reason: 'finding_not_found' }
  if (state === 'clear') return { ok: false, reason: 'finding_not_dismissable' }
  const result = await queryable.query<{
    reason: string | null
    dismissed_by: string
    dismissed_at: string
  }>(
    `insert into verification_finding_dismissals (
       run_id, finding_id, organisation_id, reason, dismissed_by, dismissed_at
     ) values ($1, $2, $3, $4, $5, now())
     on conflict (run_id, finding_id) do update set
       reason = excluded.reason,
       dismissed_by = excluded.dismissed_by,
       dismissed_at = now()
     returning reason, dismissed_by,
       to_char(
         dismissed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
       ) as dismissed_at`,
    [input.runId, input.findingId, user.organisationId, input.reason, user.id],
  )
  const row = result.rows[0]
  if (!row) return { ok: false, reason: 'finding_not_found' }
  return {
    ok: true,
    dismissal: {
      reason: row.reason,
      dismissedBy: row.dismissed_by,
      dismissedByName:
        (await dismissalName(
          queryable,
          user.organisationId,
          row.dismissed_by,
        )) ?? null,
      dismissedAt: row.dismissed_at,
    },
  }
}

/**
 * Put a dismissed finding back in the queue. The dismissal row is the only
 * record of the decision, so removing it is audited by the route: deleting a
 * row leaves no trace of who reopened the finding or when. Reopening needs the
 * same edit access as dismissing, because it changes what everyone in the
 * matter sees as outstanding work.
 */
export async function undismissVerificationFinding(
  queryable: Pick<Pool, 'query'>,
  user: AuthenticatedOrgUser,
  input: { runId: string; findingId: string },
): Promise<UndismissFindingOutcome> {
  const run = await getVerificationRun(queryable, user, input.runId, 'edit')
  if (!run) return { ok: false, reason: 'run_not_found' }
  const result = await queryable.query(
    `delete from verification_finding_dismissals
     where run_id = $1 and finding_id = $2 and organisation_id = $3`,
    [input.runId, input.findingId, user.organisationId],
  )
  return { ok: true, removed: (result.rowCount ?? 0) > 0 }
}
