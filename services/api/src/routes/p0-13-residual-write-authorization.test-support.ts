import type { StorageService } from '../storage'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentAccessRoutes } from './document-access'
import { createDocumentsRoutes } from './documents'
import { createMattersRoutes } from './matters'
import type { UserRole } from '@obiter/contracts'

/**
 * P0.13 residual write paths: matter PATCH, matter soft-delete and restore,
 * document upload, document soft-delete and restore, and actor-side share
 * grant/revoke. Each app below runs the real route against a real database so a
 * lock order can be observed rather than assumed.
 */

/**
 * A session user for the seeded database rows. The route's role check reads the
 * session, while membership is re-read from the `users` row, so the two are
 * deliberately separate.
 */
export function sessionUser(
  seed: { orgId: string; ownerId: string; editorId: string },
  which: 'owner' | 'editor',
  role: UserRole,
): AuthzUser {
  return {
    id: which === 'owner' ? seed.ownerId : seed.editorId,
    organisationId: seed.orgId,
    role,
  }
}

function routeApp(
  pool: Pool,
  user: AuthzUser,
  requestId: string,
  wire: (routes: Hono<{ Variables: AuthzVariables }>, pool: Pool) => void,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', requestId)
    c.set('user', user)
    await next()
  })
  wire(routes, pool)
  return routes
}

export function mattersApp(pool: Pool, user: AuthzUser, requestId: string) {
  return routeApp(pool, user, requestId, (routes, current) => {
    routes.route('/', createMattersRoutes(current))
  })
}

export function documentsApp(
  pool: Pool,
  storage: StorageService,
  user: AuthzUser,
  requestId: string,
) {
  return routeApp(pool, user, requestId, (routes, current) => {
    routes.route('/', createDocumentsRoutes(current, storage))
  })
}

export function sharesApp(pool: Pool, user: AuthzUser, requestId: string) {
  return routeApp(pool, user, requestId, (routes, current) => {
    routes.route('/', createDocumentAccessRoutes(current))
  })
}

/** All three real route groups over one pool, for positive controls. */
export function fullApp(
  pool: Pool,
  storage: StorageService,
  user: AuthzUser,
  requestId: string,
) {
  return routeApp(pool, user, requestId, (routes, current) => {
    routes.route('/', createMattersRoutes(current))
    routes.route('/', createDocumentsRoutes(current, storage))
    routes.route('/', createDocumentAccessRoutes(current))
  })
}

export const residualUploadBytes = Buffer.from(
  'Synthetic residual-authorization upload body.\n',
)

export function uploadRequest() {
  const form = new FormData()
  form.set(
    'file',
    new File([residualUploadBytes], 'synthetic-residual.txt', {
      type: 'text/plain',
    }),
  )
  return { method: 'POST', body: form }
}
