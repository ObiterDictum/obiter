import { z } from 'zod'
import { Hono } from 'hono'
import {
  createClient,
  search,
  type AtlasSearchFilters,
} from '@ormont/search-client'
import type { ApiErrorResponse } from '@ormont/contracts'
import type { ApiEnv } from '../env'

interface AtlasRouteVariables {
  requestId: string
}

const atlasSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  court: z.string().trim().min(1).optional(),
  jurisdiction: z.string().trim().min(1).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  sourceType: z.string().trim().min(1).optional(),
})

function apiError(
  code: ApiErrorResponse['error']['code'],
  message: string,
  requestId: string,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
    },
  }
}

export function createAtlasRoutes(env: ApiEnv) {
  const app = new Hono<{ Variables: AtlasRouteVariables }>()
  const client = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)

  app.get('/api/atlas/search', async (c) => {
    const requestId = c.get('requestId')
    const parsed = atlasSearchQuerySchema.safeParse(c.req.query())

    if (!parsed.success) {
      return c.json(
        apiError('validation_failed', 'Atlas search query is invalid.', requestId),
        400,
      )
    }

    const filters: AtlasSearchFilters = {
      court: parsed.data.court,
      jurisdiction: parsed.data.jurisdiction,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      sourceType: parsed.data.sourceType,
    }

    const result = await search(
      client,
      env.atlasAuthoritiesIndex,
      parsed.data.q,
      filters,
    )

    return c.json({
      hits: result.hits,
      query: result.query,
      estimatedTotalHits: result.estimatedTotalHits,
      processingTimeMs: result.processingTimeMs,
    })
  })

  return app
}
