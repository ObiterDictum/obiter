import type { Context } from 'hono'
import type { Pool } from 'pg'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  UserRole,
} from '@obiter/contracts'
import { ensureOrganisationForUser } from './organisation-database'

export interface AuthzUser {
  id: string
  name?: string
  organisationId?: string | null
  role?: UserRole | null
}

export interface AuthzVariables {
  requestId: string
  user: AuthzUser | null
}

export type AuthzContext = Context<{ Variables: AuthzVariables }>

export interface AuthenticatedOrgUser {
  id: string
  name?: string
  organisationId: string
  role: UserRole
}

export async function ensureOrgUser(
  c: AuthzContext,
  pool: Pool,
): Promise<AuthenticatedOrgUser | Response> {
  const user = c.get('user')
  if (!user) {
    return authzError(c, 'unauthenticated', 'Sign in is required.', 401)
  }
  if (user.organisationId) {
    return {
      id: user.id,
      ...(user.name ? { name: user.name } : {}),
      organisationId: user.organisationId,
      role: user.role ?? 'member',
    }
  }

  try {
    const ensured = await ensureOrganisationForUser(pool, {
      userId: user.id,
      requestId: c.get('requestId'),
    })
    c.set('user', {
      ...user,
      organisationId: ensured.organisationId,
      role: ensured.role,
    })
    return {
      id: user.id,
      ...(user.name ? { name: user.name } : {}),
      organisationId: ensured.organisationId,
      role: ensured.role,
    }
  } catch (error) {
    console.error('organisation_ensure_failed', {
      requestId: c.get('requestId'),
      reason: error instanceof Error ? error.message : 'unknown failure',
    })
    return authzError(
      c,
      'storage_unavailable',
      'Could not prepare your workspace. Try again.',
      503,
    )
  }
}

export async function requireManageRole(
  c: AuthzContext,
  pool: Pool,
): Promise<AuthenticatedOrgUser | Response> {
  const user = await ensureOrgUser(c, pool)
  if (user instanceof Response) return user
  if (user.role !== 'owner' && user.role !== 'admin') {
    return authzError(
      c,
      'forbidden',
      'Only owners and admins may perform this action.',
      403,
    )
  }
  return user
}

export async function requireOwnerRole(
  c: AuthzContext,
  pool: Pool,
): Promise<AuthenticatedOrgUser | Response> {
  const user = await ensureOrgUser(c, pool)
  if (user instanceof Response) return user
  if (user.role !== 'owner') {
    return authzError(
      c,
      'forbidden',
      'Only owners may perform this action.',
      403,
    )
  }
  return user
}

type RoleRank = { member: number; admin: number; owner: number }

const ROLE_RANK: RoleRank = { member: 0, admin: 1, owner: 2 }

export function canGrantRole(actor: UserRole, granted: UserRole): boolean {
  return ROLE_RANK[granted] <= ROLE_RANK[actor]
}

function authzError(
  c: AuthzContext,
  code: ApiErrorCode,
  message: string,
  status: 401 | 403 | 503,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}
