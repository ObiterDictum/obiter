import type { Pool } from 'pg'
import type {
  ApiErrorResponse,
  MatterAccessDecision,
  MatterAccessLevel,
} from '@obiter/contracts'
import { matterAccessLevelSchema } from '@obiter/contracts'
import {
  ensureOrgUser,
  type AuthenticatedOrgUser,
  type AuthzContext,
} from './authz'

interface MatterAccessRow {
  created_by: string
  access_level: unknown
}

export async function resolveMatterAccess(
  pool: Pool,
  user: AuthenticatedOrgUser,
  matterId: string,
  requiredLevel: MatterAccessLevel,
): Promise<MatterAccessDecision> {
  const result = await pool.query<MatterAccessRow>(
    `
      select matter.created_by, share.access_level
      from matters matter
      left join matter_shares share
        on share.matter_id = matter.id
        and share.organisation_id = matter.organisation_id
        and share.grantee_user_id = $3
      where matter.id = $1
        and matter.organisation_id = $2
        and matter.deleted_at is null
    `,
    [matterId, user.organisationId, user.id],
  )
  const row = result.rows[0]
  if (!row) return 'denied'
  if (row.created_by === user.id) return 'edit'
  if (row.access_level === null) return 'denied'

  const grantedLevel = matterAccessLevelSchema.parse(row.access_level)
  if (grantedLevel === 'edit') return 'edit'
  if (grantedLevel === 'view' && requiredLevel === 'view') return 'view'
  return 'denied'
}

export async function requireMatterAccess(
  c: AuthzContext,
  pool: Pool,
  matterId: string,
  requiredLevel: MatterAccessLevel,
): Promise<AuthenticatedOrgUser | Response> {
  const user = await ensureOrgUser(c, pool)
  if (user instanceof Response) return user

  const decision = await resolveMatterAccess(
    pool,
    user,
    matterId,
    requiredLevel,
  )
  if (decision === 'denied') {
    const body: ApiErrorResponse = {
      error: {
        code: 'matter_not_found',
        message: 'Matter not found.',
        requestId: c.get('requestId'),
      },
    }
    return c.json(body, 404)
  }
  return user
}
