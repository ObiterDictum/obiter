import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  ORGANISATION_NAME_MAX_LENGTH,
  acceptOrganisationInviteInputSchema,
  createOrganisationInviteInputSchema,
  organisationInviteSchema,
  organisationMemberSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type UserRole,
} from '@obiter/contracts'
import { sendEmail } from '../auth'
import { requireManageRole, requireOwnerRole } from '../authz'
import { createOrganisationForUser } from '../database'
import { organisationInviteEmail } from '../email-templates'
import type { ApiEnv } from '../env'
import {
  moveUserAndDeleteEmptyOrganisation,
  organisationHasBlockingWork,
} from '../organisation-membership'

interface RouteUser {
  id: string
  email?: string
  emailVerified?: boolean
  organisationId?: string | null
}

interface RouteVariables {
  requestId: string
  user: RouteUser | null
}

type RouteContext = Context<{ Variables: RouteVariables }>

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const NOT_EMPTY_MESSAGE =
  'Your current organisation still has matters, other members, or pending invites. Obiter will not move or delete that data, so this invite cannot be accepted. Revoke pending invites first.'

interface InviteRow {
  id: string
  organisation_id: string
  email: string
  role: UserRole
  expires_at: Date | string
  created_by: string
  created_at: Date | string
  accepted_at: Date | string | null
  revoked_at: Date | string | null
}

function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 409,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

function requireAuthenticatedUser(c: RouteContext): { id: string } | Response {
  const user = c.get('user')
  if (!user) {
    return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
  }
  return { id: user.id }
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function mapInvite(row: InviteRow) {
  return organisationInviteSchema.parse({
    id: row.id,
    organisationId: row.organisation_id,
    email: row.email,
    role: row.role,
    expiresAt: iso(row.expires_at),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  })
}

function callerOwnsOrganisation(
  c: RouteContext,
  organisationId: string,
  callerOrganisationId: string,
) {
  if (organisationId !== callerOrganisationId) {
    return errorResponse(
      c,
      'forbidden',
      'You can only act on your own organisation.',
      403,
    )
  }
  return null
}

/**
 * Organisation creation. Every user is auto-provisioned a private organisation
 * on first authorised request via ensureOrgUser, so this route usually returns
 * 409. It exists for the remaining case where that has not happened. The
 * single-org model holds: a user that already has an organisation gets a 409
 * conflict. Creation and the owner assignment are transactional in
 * createOrganisationForUser.
 *
 * Accepting an invite therefore means leaving an organisation, which is why
 * the accept path moves the user and deletes the vacated organisation when it
 * is empty.
 */
export function createOrganisationsRoutes(pool: Pool, env: ApiEnv) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.post('/api/organisations', async (c) => {
    const user = requireAuthenticatedUser(c)
    if (user instanceof Response) return user

    const value: unknown = await c.req.json().catch(() => null)
    const rawName =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).name
        : undefined

    if (typeof rawName !== 'string') {
      return errorResponse(
        c,
        'validation_failed',
        'Organisation name is required.',
        400,
      )
    }

    // Strip Unicode format characters (category Cf — zero-width spaces, joiners,
    // directional marks) as well as ASCII whitespace before the emptiness check.
    // A name of only ZWSPs would otherwise pass trim() as non-empty and store
    // an invisible organisation name.
    const name = rawName.replace(/\p{Cf}/gu, '').trim()
    if (name.length === 0) {
      return errorResponse(
        c,
        'validation_failed',
        'Organisation name is required.',
        400,
      )
    }
    if (name.length > ORGANISATION_NAME_MAX_LENGTH) {
      return errorResponse(
        c,
        'validation_failed',
        `Organisation name must be at most ${ORGANISATION_NAME_MAX_LENGTH} characters.`,
        400,
      )
    }

    const result = await createOrganisationForUser(pool, {
      userId: user.id,
      name,
      requestId: c.get('requestId'),
    })

    if (!result.created) {
      return errorResponse(
        c,
        'conflict_detected',
        'You already have an organisation.',
        409,
      )
    }

    return c.json({ organisation: result.organisation }, 201)
  })

  routes.post('/api/organisations/:organisationId/invites', async (c) => {
    const caller = await requireManageRole(c, pool)
    if (caller instanceof Response) return caller
    const denied = callerOwnsOrganisation(
      c,
      c.req.param('organisationId'),
      caller.organisationId,
    )
    if (denied) return denied

    const body = createOrganisationInviteInputSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!body.success) {
      return errorResponse(
        c,
        'validation_failed',
        'A valid email and role are required.',
        400,
      )
    }
    const email = body.data.email.toLowerCase()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    try {
      const inserted = await pool.query<InviteRow>(
        `
          insert into organisation_invites (
            organisation_id, email, role, token_hash, expires_at, created_by
          )
          values ($1, $2, $3, $4, $5, $6)
          returning id, organisation_id, email, role, expires_at, created_by,
            created_at, accepted_at, revoked_at
        `,
        [
          caller.organisationId,
          email,
          body.data.role,
          hashToken(token),
          expiresAt.toISOString(),
          caller.id,
        ],
      )
      const row = inserted.rows[0]
      const url = `${env.webOrigin}/invites/accept?token=${encodeURIComponent(token)}`
      const emailContent = organisationInviteEmail(url)
      try {
        await sendEmail(env, {
          email,
          url,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          logLabel: 'Organisation-invite',
        })
      } catch (error) {
        await pool.query(`delete from organisation_invites where id = $1`, [
          row.id,
        ])
        throw error
      }
      return c.json({ invite: mapInvite(row) }, 201)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return errorResponse(
          c,
          'conflict_detected',
          'An open invite already exists for this email.',
          409,
        )
      }
      throw error
    }
  })

  routes.get('/api/organisations/:organisationId/invites', async (c) => {
    const caller = await requireManageRole(c, pool)
    if (caller instanceof Response) return caller
    const denied = callerOwnsOrganisation(
      c,
      c.req.param('organisationId'),
      caller.organisationId,
    )
    if (denied) return denied

    const listed = await pool.query<InviteRow>(
      `
        select id, organisation_id, email, role, expires_at, created_by,
          created_at, accepted_at, revoked_at
        from organisation_invites
        where organisation_id = $1
          and accepted_at is null
          and revoked_at is null
        order by created_at desc
      `,
      [caller.organisationId],
    )
    return c.json({ invites: listed.rows.map(mapInvite) })
  })

  routes.delete(
    '/api/organisations/:organisationId/invites/:inviteId',
    async (c) => {
      const caller = await requireManageRole(c, pool)
      if (caller instanceof Response) return caller
      const denied = callerOwnsOrganisation(
        c,
        c.req.param('organisationId'),
        caller.organisationId,
      )
      if (denied) return denied

      const revoked = await pool.query<{ id: string }>(
        `
          update organisation_invites
          set revoked_at = now()
          where id = $1
            and organisation_id = $2
            and accepted_at is null
            and revoked_at is null
          returning id
        `,
        [c.req.param('inviteId'), caller.organisationId],
      )
      if (!revoked.rows[0]) {
        return errorResponse(c, 'invite_not_found', 'Invite not found.', 404)
      }
      return c.json({ revoked: true, inviteId: revoked.rows[0].id })
    },
  )

  routes.get('/api/organisations/:organisationId/members', async (c) => {
    const caller = await requireManageRole(c, pool)
    if (caller instanceof Response) return caller
    const denied = callerOwnsOrganisation(
      c,
      c.req.param('organisationId'),
      caller.organisationId,
    )
    if (denied) return denied

    const members = await pool.query<{
      id: string
      email: string
      name: string
      role: UserRole
    }>(
      `
        select id, email, name, role
        from users
        where "organisationId" = $1
          and role is not null
        order by name
      `,
      [caller.organisationId],
    )
    return c.json({
      members: members.rows.map((row) => organisationMemberSchema.parse(row)),
    })
  })

  routes.delete(
    '/api/organisations/:organisationId/members/:userId',
    async (c) => {
      const caller = await requireOwnerRole(c, pool)
      if (caller instanceof Response) return caller
      const denied = callerOwnsOrganisation(
        c,
        c.req.param('organisationId'),
        caller.organisationId,
      )
      if (denied) return denied

      const targetUserId = c.req.param('userId')
      const client = await pool.connect()
      try {
        await client.query('begin')
        const target = await client.query<{ role: UserRole }>(
          `
            select role
            from users
            where id = $1 and "organisationId" = $2
            for update
          `,
          [targetUserId, caller.organisationId],
        )
        const targetRow = target.rows[0]
        if (!targetRow) {
          await client.query('rollback')
          return errorResponse(
            c,
            'organisation_not_found',
            'Member not found.',
            404,
          )
        }
        if (targetRow.role === 'owner') {
          const owners = await client.query<{ count: string }>(
            `
              select count(*)::text as count
              from users
              where "organisationId" = $1 and role = 'owner'
            `,
            [caller.organisationId],
          )
          if (Number(owners.rows[0]?.count ?? 0) <= 1) {
            await client.query('rollback')
            return errorResponse(
              c,
              'forbidden',
              'The last owner cannot be removed.',
              403,
            )
          }
        }
        await client.query(
          `
            update users
            set "organisationId" = null, role = null, "updatedAt" = now()
            where id = $1
          `,
          [targetUserId],
        )
        await client.query('commit')
        return c.json({ removed: true, userId: targetUserId })
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
  )

  routes.post('/api/invites/accept', async (c) => {
    const sessionUser = c.get('user')
    if (!sessionUser) {
      return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
    }
    if (sessionUser.emailVerified !== true) {
      return errorResponse(
        c,
        'forbidden',
        'Verify your email before accepting an invite.',
        403,
      )
    }
    const sessionEmail = sessionUser.email?.toLowerCase()
    if (!sessionEmail) {
      return errorResponse(
        c,
        'forbidden',
        'This invite was sent to a different email address.',
        403,
      )
    }

    const body = acceptOrganisationInviteInputSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!body.success) {
      return errorResponse(
        c,
        'validation_failed',
        'An invite token is required.',
        400,
      )
    }

    const tokenHash = hashToken(body.data.token)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const invite = await client.query<InviteRow>(
        `
          select id, organisation_id, email, role, expires_at, created_by,
            created_at, accepted_at, revoked_at
          from organisation_invites
          where token_hash = $1
          for update
        `,
        [tokenHash],
      )
      const row = invite.rows[0]
      if (
        !row ||
        row.accepted_at ||
        row.revoked_at ||
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        await client.query('rollback')
        return errorResponse(
          c,
          'invite_not_found',
          'This invite is no longer valid.',
          404,
        )
      }
      if (row.email !== sessionEmail) {
        await client.query('rollback')
        return errorResponse(
          c,
          'forbidden',
          'This invite was sent to a different email address.',
          403,
        )
      }

      const invitee = await client.query<{
        organisationId: string | null
      }>(
        `
          select "organisationId"
          from users
          where id = $1
          for update
        `,
        [sessionUser.id],
      )
      const currentOrganisationId = invitee.rows[0]?.organisationId ?? null
      if (currentOrganisationId === row.organisation_id) {
        await client.query('rollback')
        return errorResponse(
          c,
          'conflict_detected',
          'You already belong to this organisation.',
          409,
        )
      }
      if (
        currentOrganisationId &&
        (await organisationHasBlockingWork(
          client,
          currentOrganisationId,
          sessionUser.id,
        ))
      ) {
        await client.query('rollback')
        return errorResponse(
          c,
          'organisation_not_empty',
          NOT_EMPTY_MESSAGE,
          409,
        )
      }

      await moveUserAndDeleteEmptyOrganisation(client, {
        userId: sessionUser.id,
        fromOrganisationId: currentOrganisationId,
        toOrganisationId: row.organisation_id,
        role: row.role,
      })
      await client.query(
        `
          update organisation_invites
          set accepted_at = now()
          where id = $1 and accepted_at is null and revoked_at is null
        `,
        [row.id],
      )
      await client.query('commit')
      return c.json({
        organisationId: row.organisation_id,
        role: row.role,
      })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  })

  return routes
}
