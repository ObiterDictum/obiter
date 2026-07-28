import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { StorageService } from '../storage'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import { createRedactReviewRoutes } from './redact-review'
import { createRedactRunCreationRoutes } from './redact-run-creation'
import type { RouteVariables } from './redact-shared'

export { MAX_REDACTION_SOURCE_TEXT_LENGTH } from './redact-shared'

export function createRedactRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.route('/', createRedactRunCreationRoutes(pool, storage))
  routes.route('/', createRedactReviewRoutes(pool, storage))
  routes.route('/', createRedactLifecycleRoutes(pool, storage))

  return routes
}
