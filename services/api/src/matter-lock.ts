import type { PoolClient } from 'pg'
import { matterAccessPredicate } from './matter-access-boundary'

type MatterLockState = 'active' | 'deleted'

async function lockMatterRowForEdit(
  client: PoolClient,
  input: { organisationId: string; matterId: string; userId: string },
  state: MatterLockState,
): Promise<{ deletedAt: string | null } | null> {
  const stateClause = state === 'deleted' ? 'is not null' : 'is null'
  const lockColumns = state === 'deleted' ? 'id, deleted_at::text' : 'id'
  const matter = await client.query<{
    id: string
    deleted_at?: string | null
  }>(
    `select ${lockColumns} from matters
     where id = $1 and organisation_id = $2 and deleted_at ${stateClause}
     for update`,
    [input.matterId, input.organisationId],
  )
  const row = matter.rows[0]
  if (!row) return null

  const access = await client.query<{ id: string }>(
    `select matter.id from matters matter
     where matter.id = $1
       and matter.organisation_id = $2
       and matter.deleted_at ${stateClause}
       and ${matterAccessPredicate('$3', "'edit'")}`,
    [input.matterId, input.organisationId, input.userId],
  )
  if (access.rows.length !== 1) return null

  const member = await client.query<{ id: string }>(
    `select id from users where id = $1 and "organisationId" = $2 for share`,
    [input.userId, input.organisationId],
  )
  if (member.rows.length !== 1) return null

  return { deletedAt: state === 'deleted' ? (row.deleted_at ?? null) : null }
}

export async function lockMatterForEdit(
  client: PoolClient,
  input: { organisationId: string; matterId: string; userId: string },
): Promise<boolean> {
  return (await lockMatterRowForEdit(client, input, 'active')) !== null
}

export async function lockDeletedMatterForEdit(
  client: PoolClient,
  input: { organisationId: string; matterId: string; userId: string },
): Promise<string | null> {
  const locked = await lockMatterRowForEdit(client, input, 'deleted')
  return locked?.deletedAt ?? null
}
