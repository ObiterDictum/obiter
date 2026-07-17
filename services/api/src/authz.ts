import type { Context } from 'hono'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  UserRole,
} from '@obiter/contracts'

/**
 * The session user as seen by route handlers. better-auth exposes `role`
 * (owner/admin/member) via user.additionalFields; org-less users have a null
 * role and organisationId.
 */
export interface AuthzUser {
  id: string
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
  organisationId: string
  role: UserRole
}

/**
 * Authenticates the caller and confirms they belong to an organisation. Returns
 * the org-scoped user, or a 401/403 Response for the caller to return.
 */
export function requireOrgUser(
  c: AuthzContext,
): AuthenticatedOrgUser | Response {
  const user = c.get('user')
  if (!user) {
    return authzError(c, 'unauthenticated', 'Sign in is required.', 401)
  }
  if (!user.organisationId) {
    return authzError(
      c,
      'no_organisation',
      'Create an organisation to use this area.',
      403,
    )
  }
  return {
    id: user.id,
    organisationId: user.organisationId,
    role: user.role ?? 'member',
  }
}

/**
 * Requires an owner or admin role. This is the first real authorization
 * distinction in the product: members may not delete, restore, or read the
 * audit report of a deleted run. Enforced server-side — UI hiding is not
 * authorization. An org-less user is rejected by requireOrgUser first.
 */
export function requireManageRole(
  c: AuthzContext,
): AuthenticatedOrgUser | Response {
  const user = requireOrgUser(c)
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

function authzError(
  c: AuthzContext,
  code: ApiErrorCode,
  message: string,
  status: 401 | 403,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}
