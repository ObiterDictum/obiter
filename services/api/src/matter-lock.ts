import type { PoolClient } from 'pg'
import { matterAccessPredicate } from './matter-access-boundary'

/**
 * Locks the parent matter and re-evaluates `edit` access under that lock.
 *
 * This is the matter-first prefix of the one lock order used by linked
 * mutations (matter, document, redaction run(s), matter share). Explicit
 * matter-share revocation takes the same matter lock before deleting the
 * share, so a write cannot commit on a grant that the revocation removed.
 *
 * Member removal takes no matter lock; it locks the departing user row
 * `FOR UPDATE` and then deletes that user's shares. The `FOR SHARE` on the
 * acting user row below is therefore the second half of the commit-time
 * check: it serialises the write with removal (and with ownership or
 * organisation changes that lock the same row). A write that gets the share
 * lock first commits and removal follows; a removal that gets it first makes
 * the write observe the removed membership. This also closes the `created_by`
 * branch of `matterAccessPredicate`, which deleting shares cannot change: the
 * `FOR SHARE` re-reads the row that removal clears, so a removed creator
 * matches no user row even though `matters.created_by` still names them.
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
    `select matter.id from matters matter
     where matter.id = $1
       and matter.organisation_id = $2
       and matter.deleted_at is null
       and ${matterAccessPredicate('$3', "'edit'")}
     for update`,
    [input.matterId, input.organisationId, input.userId],
  )
  if (matter.rows.length !== 1) return false

  const member = await client.query<{ id: string }>(
    `select id from users where id = $1 and "organisationId" = $2 for share`,
    [input.userId, input.organisationId],
  )
  return member.rows.length === 1
}
