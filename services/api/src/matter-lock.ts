import type { PoolClient } from 'pg'
import { matterAccessPredicate } from './matter-access-boundary'

/**
 * Locks the parent matter and re-evaluates `edit` access under that lock.
 *
 * This is the matter-first prefix of the one lock order used by linked
 * mutations (matter, document, redaction run(s), matter share). Share
 * revocation takes the same lock before deleting the share, so a write that
 * follows this call cannot commit on an authorization decision made before a
 * revocation: whichever transaction takes the matter lock first forces the
 * other to observe its result. The predicate is re-read in the locking
 * statement, not before it, so a revoked grantee matches no row.
 *
 * An empty result is a permission denial the caller reports as the concealed
 * document-not-found outcome. A real lock or database failure throws, and must
 * not be reported as a denial.
 */
export async function lockMatterForEdit(
  client: PoolClient,
  input: { organisationId: string; matterId: string; userId: string },
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `select matter.id from matters matter
     where matter.id = $1
       and matter.organisation_id = $2
       and matter.deleted_at is null
       and ${matterAccessPredicate('$3', "'edit'")}
     for update`,
    [input.matterId, input.organisationId, input.userId],
  )
  return result.rows.length === 1
}
