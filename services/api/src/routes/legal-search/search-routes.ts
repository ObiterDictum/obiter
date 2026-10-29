import { Hono } from 'hono'
import { createClient, getIndexStatus } from '@obiter/search-client'
import type { ApiEnv } from '../../env'

interface LegalSearchRouteVariables {
  requestId: string
}

const searchReadinessTimeoutMs = 1500

export function createLegalSearchRoutes(env: ApiEnv) {
  const app = new Hono<{ Variables: LegalSearchRouteVariables }>()
  const client = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)

  app.get('/api/search/readiness', async (c) => {
    const [authorities, provisions] = await Promise.all([
      getIndexStatus(
        client,
        env.legalAuthoritiesIndex,
        searchReadinessTimeoutMs,
      ),
      getIndexStatus(
        client,
        env.legislationProvisionsIndex,
        searchReadinessTimeoutMs,
      ),
    ])
    return c.json({
      index: env.legalAuthoritiesIndex,
      ...authorities,
      indexes: [
        { index: env.legalAuthoritiesIndex, ...authorities },
        { index: env.legislationProvisionsIndex, ...provisions },
      ],
    })
  })

  return app
}
