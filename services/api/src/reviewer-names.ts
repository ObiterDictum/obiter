import type { Pool } from 'pg'

/**
 * Display names for the people whose decisions a record carries. A decision
 * stores the deciding user's id; a reviewer reading "Dismissed by …" needs the
 * colleague's member name, not an internal id and never their email address.
 *
 * Names are read from the organisation's own members, so a decision recorded by
 * somebody who has since left the organisation resolves to null and is shown
 * unnamed rather than leaking an account detail. The caller has already been
 * authorised for the run, so this only ever widens a read within one tenant.
 */
export async function reviewerNames(
  queryable: Pick<Pool, 'query'>,
  organisationId: string,
  userIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map()
  const result = await queryable.query<{ id: string; name: string }>(
    `select id, name from users
     where "organisationId" = $1 and id = any($2::text[])`,
    [organisationId, ids],
  )
  return new Map(result.rows.map((row) => [row.id, row.name]))
}
