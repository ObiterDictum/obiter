import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool, PoolClient } from 'pg'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  MatterAccessLevel,
} from '@obiter/contracts'
import {
  matterShareCreateRequestSchema,
  matterShareCreateResponseSchema,
  matterShareGrantSchema,
  matterShareListResponseSchema,
  matterShareRevokeRequestSchema,
  matterShareRevokeResponseSchema,
} from '@obiter/contracts'
import { ensureOrgUser, type AuthzVariables } from '../authz'
import { appendAuditLog, getMatter } from '../database'

interface MatterShareRow {
  id: string
  matter_id: string
  grantee_user_id: string
  access_level: MatterAccessLevel
  created_by: string
  created_at: Date | string
}

type RouteContext = Context<{ Variables: AuthzVariables }>

type GrantResult =
  | { status: 'ok'; share: MatterShareRow }
  | { status: 'matter_not_found' }
  | { status: 'forbidden' }
  | { status: 'invalid_grantee' }

type RevokeResult =
  | { status: 'ok'; granteeUserId: string }
  | { status: 'matter_not_found' }
  | { status: 'forbidden' }
  | { status: 'share_not_found' }

function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 403 | 404,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

function mapShare(row: MatterShareRow) {
  return matterShareGrantSchema.parse({
    id: row.id,
    matterId: row.matter_id,
    granteeUserId: row.grantee_user_id,
    accessLevel: row.access_level,
    createdBy: row.created_by,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  })
}

async function lockOwnedMatter(
  client: PoolClient,
  input: { matterId: string; organisationId: string; ownerUserId: string },
) {
  const matter = await client.query<{ created_by: string }>(
    `select created_by
     from matters
     where id = $1 and organisation_id = $2 and deleted_at is null
     for update`,
    [input.matterId, input.organisationId],
  )
  const row = matter.rows[0]
  if (!row) return 'matter_not_found' as const
  if (row.created_by !== input.ownerUserId) return 'forbidden' as const
  return row
}

async function grantMatterShare(
  pool: Pool,
  input: {
    matterId: string
    organisationId: string
    ownerUserId: string
    granteeUserId: string
    accessLevel: MatterAccessLevel
    requestId: string
  },
): Promise<GrantResult> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const matter = await lockOwnedMatter(client, input)
    if (matter === 'matter_not_found' || matter === 'forbidden') {
      await client.query('rollback')
      return { status: matter }
    }
    if (input.granteeUserId === matter.created_by) {
      await client.query('rollback')
      return { status: 'invalid_grantee' }
    }

    const grantee = await client.query<{ id: string }>(
      `select id
       from users
       where id = $1 and "organisationId" = $2
       for share`,
      [input.granteeUserId, input.organisationId],
    )
    if (grantee.rows.length === 0) {
      await client.query('rollback')
      return { status: 'invalid_grantee' }
    }

    const grant = await client.query<MatterShareRow>(
      `insert into matter_shares (
         organisation_id, matter_id, grantee_user_id, access_level,
         created_by, created_at
       )
       values ($1, $2, $3, $4, $5, now())
       on conflict (matter_id, grantee_user_id) do update
       set access_level = excluded.access_level,
         created_by = excluded.created_by,
         created_at = now()
       returning id, matter_id, grantee_user_id, access_level, created_by, created_at`,
      [
        input.organisationId,
        input.matterId,
        input.granteeUserId,
        input.accessLevel,
        input.ownerUserId,
      ],
    )
    const share = grant.rows[0]
    if (!share) throw new Error('Matter share upsert returned no row.')

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.ownerUserId,
      entityType: 'matter_share',
      entityId: share.id,
      action: 'matter.share_grant',
      metadata: {
        matterId: input.matterId,
        granteeUserId: input.granteeUserId,
        accessLevel: input.accessLevel,
      },
      requestId: input.requestId,
    })
    await client.query('commit')
    return { status: 'ok', share }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function revokeMatterShare(
  pool: Pool,
  input: {
    matterId: string
    shareId: string
    organisationId: string
    ownerUserId: string
    requestId: string
  },
): Promise<RevokeResult> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const matter = await lockOwnedMatter(client, input)
    if (matter === 'matter_not_found' || matter === 'forbidden') {
      await client.query('rollback')
      return { status: matter }
    }

    const revoked = await client.query<{ grantee_user_id: string }>(
      `delete from matter_shares
       where id = $1 and matter_id = $2 and organisation_id = $3
       returning grantee_user_id`,
      [input.shareId, input.matterId, input.organisationId],
    )
    const share = revoked.rows[0]
    if (!share) {
      await client.query('rollback')
      return { status: 'share_not_found' }
    }

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.ownerUserId,
      entityType: 'matter_share',
      entityId: input.shareId,
      action: 'matter.share_revoke',
      metadata: {
        matterId: input.matterId,
        granteeUserId: share.grantee_user_id,
      },
      requestId: input.requestId,
    })
    await client.query('commit')
    return { status: 'ok', granteeUserId: share.grantee_user_id }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function createDocumentAccessRoutes(pool: Pool) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/matters/:matterId/shares', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const matter = await getMatter(
      pool,
      user.organisationId,
      c.req.param('matterId'),
    )
    if (!matter)
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    if (matter.createdBy !== user.id)
      return errorResponse(
        c,
        'forbidden',
        'Only the matter owner may manage shares.',
        403,
      )

    const grants = await pool.query<MatterShareRow>(
      `select id, matter_id, grantee_user_id, access_level, created_by, created_at
       from matter_shares
       where organisation_id = $1 and matter_id = $2
       order by created_at, id`,
      [user.organisationId, matter.id],
    )
    const response = matterShareListResponseSchema.parse({
      ownerUserId: matter.createdBy,
      shares: grants.rows.map(mapShare),
    })
    return c.json(response)
  })

  routes.post('/api/matters/:matterId/shares', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const matter = await getMatter(
      pool,
      user.organisationId,
      c.req.param('matterId'),
    )
    if (!matter)
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    if (matter.createdBy !== user.id)
      return errorResponse(
        c,
        'forbidden',
        'Only the matter owner may manage shares.',
        403,
      )

    const body = matterShareCreateRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!body.success)
      return errorResponse(
        c,
        'validation_failed',
        'A grantee user and access level are required.',
        400,
      )

    const result = await grantMatterShare(pool, {
      matterId: matter.id,
      organisationId: user.organisationId,
      ownerUserId: user.id,
      granteeUserId: body.data.granteeUserId,
      accessLevel: body.data.accessLevel,
      requestId: c.get('requestId'),
    })
    if (result.status === 'matter_not_found')
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    if (result.status === 'forbidden')
      return errorResponse(
        c,
        'forbidden',
        'Only the matter owner may manage shares.',
        403,
      )
    if (result.status === 'invalid_grantee')
      return errorResponse(
        c,
        'validation_failed',
        'The grantee must be another current member of this organisation.',
        400,
      )

    const response = matterShareCreateResponseSchema.parse({
      share: mapShare(result.share),
    })
    return c.json(response, 201)
  })

  routes.delete('/api/matters/:matterId/shares/:shareId', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const matter = await getMatter(
      pool,
      user.organisationId,
      c.req.param('matterId'),
    )
    if (!matter)
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    if (matter.createdBy !== user.id)
      return errorResponse(
        c,
        'forbidden',
        'Only the matter owner may manage shares.',
        403,
      )

    const request = matterShareRevokeRequestSchema.safeParse({
      shareId: c.req.param('shareId'),
    })
    if (!request.success)
      return errorResponse(
        c,
        'validation_failed',
        'A share id is required.',
        400,
      )

    const result = await revokeMatterShare(pool, {
      matterId: matter.id,
      shareId: request.data.shareId,
      organisationId: user.organisationId,
      ownerUserId: user.id,
      requestId: c.get('requestId'),
    })
    if (result.status === 'matter_not_found')
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    if (result.status === 'forbidden')
      return errorResponse(
        c,
        'forbidden',
        'Only the matter owner may manage shares.',
        403,
      )
    if (result.status === 'share_not_found')
      return errorResponse(
        c,
        'matter_share_not_found',
        'Matter share not found.',
        404,
      )

    const response = matterShareRevokeResponseSchema.parse({
      revoked: true,
      shareId: request.data.shareId,
    })
    return c.json(response)
  })

  return routes
}
