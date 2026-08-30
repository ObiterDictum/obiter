import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { StorageService } from '../storage'
import {
  DEFAULT_API_REQUEST_LIMITS,
  type ApiRequestLimits,
} from '../request-limits'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import { createRedactReviewRoutes } from './redact-review'
import { createRedactRunCreationRoutes } from './redact-run-creation'
import type { RouteVariables } from './redact-shared'

export function createRedactRoutes(
  pool: Pool,
  storage: StorageService,
  limits: ApiRequestLimits = DEFAULT_API_REQUEST_LIMITS,
) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.route('/', createRedactRunCreationRoutes(pool, storage, limits))
  routes.route('/', createRedactReviewRoutes(pool, storage))
  routes.route('/', createRedactLifecycleRoutes(pool, storage))

  return routes
}
