import { z } from 'zod'
import { Hono } from 'hono'
import {
  createClient,
  search,
  type LegalSearchFilters,
} from '@obiter/search-client'
import { LegalSourceFamilySchema, LegalSourceTypeSchema } from '@obiter/legal-schema'
import type { ApiErrorResponse } from '@obiter/contracts'
import type { ApiEnv } from '../../env'

interface LegalSearchRouteVariables {
  requestId: string
}

const legalSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/)
  .transform((value) => value.replace(/\//g, '-'))

const legalSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  court: legalSlugSchema.optional(),
  jurisdiction: legalSlugSchema.optional(),
  legalDomain: legalSlugSchema.optional(),
  provider: legalSlugSchema.optional(),
  topic: z.string().trim().min(1).max(120).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  asAtDate: z.string().date().optional(),
  legislationVersion: z.string().trim().min(1).max(80).optional(),
  sourceType: LegalSourceTypeSchema.optional(),
  sourceFamily: LegalSourceFamilySchema.optional(),
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

export function createLegalSearchRoutes(env: ApiEnv) {
  const app = new Hono<{ Variables: LegalSearchRouteVariables }>()
  const client = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)

  app.get('/api/search', async (c) => {
    const requestId = c.get('requestId')
    const parsed = legalSearchQuerySchema.safeParse(c.req.query())

    if (!parsed.success) {
      return c.json(
        apiError('validation_failed', 'Search query is invalid.', requestId),
        400,
      )
    }

    if (parsed.data.sourceType && parsed.data.sourceType !== 'judgment') {
      return c.json({
        hits: [],
        query: parsed.data.q,
        estimatedTotalHits: 0,
        processingTimeMs: 0,
        outcome: 'unsupported_source_type',
      })
    }

    const filters: LegalSearchFilters = {
      court: parsed.data.court,
      jurisdiction: parsed.data.jurisdiction,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      sourceType: parsed.data.sourceType ?? 'judgment',
    }

    const result = await search(
      client,
      env.legalAuthoritiesIndex,
      parsed.data.q,
      filters,
      { includeSnippets: true },
    )

    return c.json({
      hits: result.hits.map((hit) => ({
        id: hit.id,
        title: hit.title,
        neutralCitation: hit.neutralCitation,
        court: hit.court,
        jurisdiction: hit.jurisdiction,
        dateDecided: hit.dateDecided,
        sourceType: hit.sourceType,
        sourceUrl: hit.sourceUrl,
        snippets: hit.snippets ?? [],
      })),
      query: result.query,
      estimatedTotalHits: result.estimatedTotalHits,
      processingTimeMs: result.processingTimeMs,
    })
  })

  return app
}
