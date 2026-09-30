import type { PoolClient } from 'pg'
import { matterAccessPredicate } from './matter-access-boundary'

/**
 * Locks the parent matter and re-evaluates `edit` access under that lock.
 *
 * This is the matter-first prefix of the one lock order used by linked
 * mutations (matter, user, document, redaction run(s), matter share).
 *
 * The lock and the access check are deliberately two statements. Access must
 * not be evaluated in the same statement that takes the `FOR UPDATE`: under
 * READ COMMITTED the statement snapshot and its qual are fixed when the
 * statement is issued, and a `SELECT ... FOR UPDATE` that blocks on this row
 * does not re-run that qual when the blocker commits. A share revocation or
 * edit-to-view downgrade deletes or updates only `matter_shares` and leaves the
 * matter row untouched, so there is no updated tuple to re-check — an
 * `EXISTS matter_shares` in the locking statement would authorise on the
 * pre-revocation snapshot it read before it blocked. Acquiring the row lock
 * alone means a revocation holding the lock goes first and this transaction
 * resumes after it commits; the separate statement below then reads a fresh
 * snapshot that sees the revocation. Share grant, share revoke, downgrade and
 * member removal lock the matter and/or the acting user row before writing, so
 * none can interleave between the re-check and commit.
 *
 * Member removal takes no matter lock; it locks the departing user row
 * `FOR UPDATE`, deletes that user's shares, then clears the membership. The
 * `FOR SHARE` on the acting user row below is therefore the second half of the
 * commit-time check: it serialises the write with removal (and with ownership
 * or organisation changes that lock the same row). A write that gets the share
 * lock first commits and removal follows; a removal that gets it first makes
 * the write observe the removed membership. This also closes the `created_by`
 * branch of `matterAccessPredicate`, which deleting shares cannot change: the
 * `FOR SHARE` re-reads the row that removal clears, so a removed creator
 * matches no user row even though `matters.created_by` still names them. (The
 * same statement would not hold for the matter row: removal does not touch it.)
 *
 * An empty result is a permission denial the caller reports as the concealed
 * document-not-found outcome. A real lock or database failure throws, and must
 * not be reported as a denial.
 */
export async function lockMatterForEdit(
  client: PoolClient,
  input: { organisationId: string; matterId: string; userId: string },
): Promise<boolean> {
  const matter = await client.query<{ id: string }>(
    `select id from matters
     where id = $1 and organisation_id = $2 and deleted_at is null
     for update`,
    [input.matterId, input.organisationId],
  )
  if (matter.rows.length !== 1) return false

  const access = await client.query<{ id: string }>(
    `select matter.id from matters matter
     where matter.id = $1
       and matter.organisation_id = $2
       and matter.deleted_at is null
       and ${matterAccessPredicate('$3', "'edit'")}`,
    [input.matterId, input.organisationId, input.userId],
  )
  if (access.rows.length !== 1) return false

  const member = await client.query<{ id: string }>(
    `select id from users where id = $1 and "organisationId" = $2 for share`,
    [input.userId, input.organisationId],
  )
  return member.rows.length === 1
}
