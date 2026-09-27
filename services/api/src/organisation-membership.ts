import type { Pool, PoolClient } from 'pg'
import type { ApiErrorCode, UserRole } from '@obiter/contracts'
import { appendAuditLog } from './database'

export type InviteUnavailableCode = Extract<
  ApiErrorCode,
  | 'invite_not_found'
  | 'invite_expired'
  | 'invite_revoked'
  | 'invite_already_accepted'
>

export interface InviteAvailabilityRow {
  accepted_at: Date | string | null
  revoked_at: Date | string | null
  expires_at: Date | string
}

export function inviteUnavailability(
  row: InviteAvailabilityRow | undefined,
  now = Date.now(),
): { code: InviteUnavailableCode; message: string } | null {
  if (!row) {
    return { code: 'invite_not_found', message: 'This invite was not found.' }
  }
  if (row.accepted_at) {
    return {
      code: 'invite_already_accepted',
      message: 'This invite has already been accepted.',
    }
  }
  if (row.revoked_at) {
    return {
      code: 'invite_revoked',
      message: 'This invite has been revoked.',
    }
  }
  if (new Date(row.expires_at).getTime() <= now) {
    return { code: 'invite_expired', message: 'This invite has expired.' }
  }
  return null
}

export async function loadInvitePreview(
  client: Pick<Pool | PoolClient, 'query'>,
  tokenHash: string,
): Promise<
  | { ok: true; organisationName: string; invitedByName: string }
  | { ok: false; code: InviteUnavailableCode; message: string }
> {
  const found = await client.query<
    InviteAvailabilityRow & {
      organisation_name: string
      invited_by_name: string
    }
  >(
    `
      select i.accepted_at, i.revoked_at, i.expires_at,
        o.name as organisation_name, u.name as invited_by_name
      from organisation_invites i
      join organisations o on o.id = i.organisation_id
      join users u on u.id = i.created_by
      where i.token_hash = $1
    `,
    [tokenHash],
  )
  const row = found.rows[0]
  const unavailable = inviteUnavailability(row)
  if (unavailable) return { ok: false, ...unavailable }
  if (!row) {
    return {
      ok: false,
      code: 'invite_not_found',
      message: 'This invite was not found.',
    }
  }
  return {
    ok: true,
    organisationName: row.organisation_name,
    invitedByName: row.invited_by_name,
  }
}

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
        or exists (
          select 1 from organisation_invites
          where organisation_id = $1
            and accepted_at is null
            and revoked_at is null
        )
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
      set "organisationId" = $1, role = $2, "pendingOrganisationName" = null, "updatedAt" = now()
      where id = $3
    `,
    [input.toOrganisationId, input.role, input.userId],
  )
  if (!input.fromOrganisationId) return
  // The vacated org is empty (matters, other members, artefacts, and open
  // invites are refused before this runs). Remaining audit rows are the
  // invitee's own auth and organisation.create events. Null them deliberately:
  // reassignment would be a false record (e.g. auth.sign_in/auth.sign_out
  // sessions from before the invitee joined did not happen inside the firm).
  // The real fix is a denormalised tenant snapshot that deletion does not
  // touch. Do not run this against a non-empty org.
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

/**
 * Revokes every matter share held by a member who is leaving the organisation,
 * writing the same audit row the matter-share revocation route writes. 0027's
 * composite grantee key rejects the organisationId change while a share
 * remains, so this runs in the caller's transaction before the user row is
 * updated.
 */
export async function revokeMemberMatterShares(
  client: PoolClient,
  input: {
    organisationId: string
    userId: string
    actorUserId: string
    requestId: string
  },
) {
  const revoked = await client.query<{
    id: string
    matter_id: string
    grantee_user_id: string
  }>(
    `
      delete from matter_shares
      where grantee_user_id = $1 and organisation_id = $2
      returning id, matter_id, grantee_user_id
    `,
    [input.userId, input.organisationId],
  )
  for (const share of revoked.rows) {
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.actorUserId,
      entityType: 'matter_share',
      entityId: share.id,
      action: 'matter.share_revoke',
      metadata: {
        matterId: share.matter_id,
        granteeUserId: share.grantee_user_id,
      },
      requestId: input.requestId,
    })
  }
}
