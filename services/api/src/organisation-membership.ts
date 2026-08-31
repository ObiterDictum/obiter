import type { PoolClient } from 'pg'
import type { UserRole } from '@obiter/contracts'

export async function organisationHasBlockingWork(
  client: PoolClient,
  organisationId: string,
  exceptUserId: string,
) {
  const occupied = await client.query<{ occupied: boolean }>(
    `
      select (
        exists (
          select 1 from users
          where "organisationId" = $1 and id <> $2
        )
        or exists (select 1 from matters where organisation_id = $1)
        or exists (select 1 from redaction_runs where organisation_id = $1)
        or exists (select 1 from artifacts where organisation_id = $1)
      ) as occupied
    `,
    [organisationId, exceptUserId],
  )
  return occupied.rows[0]?.occupied === true
}

export async function moveUserAndDeleteEmptyOrganisation(
  client: PoolClient,
  input: {
    userId: string
    fromOrganisationId: string | null
    toOrganisationId: string
    role: UserRole
  },
) {
  await client.query(
    `
      update users
      set "organisationId" = $1, role = $2, "updatedAt" = now()
      where id = $3
    `,
    [input.toOrganisationId, input.role, input.userId],
  )
  if (!input.fromOrganisationId) return
  await client.query(
    `update audit_logs set organisation_id = null where organisation_id = $1`,
    [input.fromOrganisationId],
  )
  await client.query(
    `delete from organisation_invites where organisation_id = $1`,
    [input.fromOrganisationId],
  )
  await client.query(`delete from organisations where id = $1`, [
    input.fromOrganisationId,
  ])
}
