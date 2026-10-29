import type { Pool } from 'pg'

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
