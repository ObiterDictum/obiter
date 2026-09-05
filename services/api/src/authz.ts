import type { Context } from 'hono'
import type { Pool } from 'pg'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  UserRole,
} from '@obiter/contracts'
import { ensureOrganisationForUser } from './database'

/**
 * The session user as seen by route handlers. better-auth exposes `role`
 * (owner/admin/member) via user.additionalFields; org-less users have a null
 * role and organisationId until they create one in Settings or a product
 * surface auto-provisions a personal workspace.
 */
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

/**
 * Authenticates the caller and ensures they have an organisation tenant.
 * Org-less users are provisioned on first Matters/Documents/Redact use —
 * with the stashed sign-up name when present, else a personal workspace —
 * so product surfaces are not gated on Settings. Returns the org-scoped
 * user, or a 401 Response for the caller to return.
 */
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

/**
 * Requires an owner or admin role. This is the first real authorization
 * distinction in the product: members may not delete, restore, or read the
 * audit report of a deleted run. Enforced server-side — UI hiding is not
 * authorization. Auto-provisions a personal workspace when still org-less.
 */
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
