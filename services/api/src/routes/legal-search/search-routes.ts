import { Hono } from 'hono'
import { createClient, getIndexStatus } from '@obiter/search-client'
import type { ApiEnv } from '../../env'

interface LegalSearchRouteVariables {
  requestId: string
}

// Short on purpose: an offline engine holds the TCP SYN long past this, and
// the probe must report unreachable instead of hanging the caller.
const searchReadinessTimeoutMs = 1500

export function createLegalSearchRoutes(env: ApiEnv) {
  const app = new Hono<{ Variables: LegalSearchRouteVariables }>()
  const client = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)

  // Index readiness with the same credentials the query path uses, so an
  // "empty" product index is reportable here instead of survey-discovered.
  // Probed live on each call behind a short timeout: readiness must stay fast
  // even when the engine is down. Both product indexes are reported: the
  // judgment corpus and the legislation provisions corpus are separate
  // Meilisearch indexes, and an empty, missing, or unreachable legislation
  // index must be as detectable as a judgment one. The top-level fields
  // stay the legal_authorities probe so existing readers (benchmark,
  // scripts) keep working; per-index detail lives in `indexes`.
  //
  // This module serves readiness only. The former GET /api/search was the
  // only other route here: Meilisearch-only, with no product caller and a
  // second validation shape beside POST /api/search/fetch. It was deleted
  // when Meilisearch became the sole query engine so the route layer cannot
  // reintroduce the split the served flow just removed.
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
