import { createClient, getIndexStatus } from '@obiter/search-client'
import { createApiApp } from './app'
import { createPool } from './database'
import { readApiEnv, type ApiEnv } from './env'
import { runMigrations } from './migrate'
import { warmRedactionDetector } from './redaction-detection'
import type { Pool } from 'pg'

export interface ApiRuntime {
  env: ApiEnv
  pool: Pool
  app: ReturnType<typeof createApiApp>
}

/**
 * Everything the API does before it binds a socket, extracted so the Node
 * adapter and the Bun adapter boot the identical application. Behaviour is
 * unchanged from `server.ts`: migrations fail closed, the index probe logs
 * without blocking, and the detection model warms without blocking.
 *
 * This is the whole of the bootstrap refactor the experiment needed. It is
 * behaviour-preserving: the same calls in the same order, moved out of
 * `main()`.
 */
export async function createApiRuntime(): Promise<ApiRuntime> {
  const env = readApiEnv()
  const pool = createPool(env)

  try {
    await runMigrations(pool)
  } catch (error) {
    // Fail closed: handlers assume the latest schema (e.g. sign-up reads the
    // column added in 0016), so serving traffic on a half-migrated database
    // would corrupt per-request state instead of producing one loud boot
    // error. Exit so the supervisor retries or pages rather than serving a
    // schema the code was not built for. runMigrations holds a Postgres
    // advisory lock, so concurrent instances queue instead of racing.
    console.error(
      'Refusing to start: pending migrations could not be applied.',
      error instanceof Error ? error.message : error,
    )
    await pool.end()
    process.exit(1)
  }

  const app = createApiApp(env, pool)

  reportIndexStatus(env)
  warmDetection(env)

  return { env, pool, app }
}

// Loud at boot, never blocking: an unreachable or empty stored index must
// be visible here, not discovered later as silent "no results". Serving
// starts regardless — queries fail visibly with 503 until the engine
// answers, because Meilisearch is the sole query layer.
function reportIndexStatus(env: ApiEnv) {
  void getIndexStatus(
    createClient(env.meilisearchHost, env.meilisearchSearchApiKey),
    env.legalAuthoritiesIndex,
  ).then((state) => {
    switch (state.status) {
      case 'ready':
        console.info('Stored search index ready.', {
          index: env.legalAuthoritiesIndex,
          documentCount: state.documentCount,
        })
        break
      case 'empty':
        console.error(
          `Stored search index "${env.legalAuthoritiesIndex}" exists but holds 0 documents — stored search returns no Meilisearch hits until documents are indexed.`,
        )
        break
      case 'missing':
        console.error(
          `Stored search index "${env.legalAuthoritiesIndex}" does not exist on ${env.meilisearchHost} — search serves 503 search_unavailable until it is rebuilt from Postgres.`,
        )
        break
      case 'unreachable':
        console.error(
          `Stored search index "${env.legalAuthoritiesIndex}" is unreachable with the configured search key (${state.reason}) on ${env.meilisearchHost} — search serves 503 search_unavailable until it answers. Check MEILISEARCH_HOST and MEILISEARCH_SEARCH_API_KEY.`,
        )
        break
    }
  })
}

// Deliberately not awaited: the first run on a cold cache downloads ~15 MB from
// Hugging Face, and health checks and every non-redaction route should be
// answering while that happens.
function warmDetection(env: ApiEnv) {
  void warmRedactionDetector().then(
    () => {
      console.info('Rampart detection model ready', {
        model: env.rampartModel,
        revision: env.rampartRevision,
        cacheDir: env.rampartCacheDir,
      })
    },
    (error: unknown) => {
      console.error(
        'Rampart detection model failed to load — redaction runs will be limited to heuristics until it does. ' +
          `Run "pnpm prefetch:rampart" to fetch it, or set OBITER_RAMPART_CACHE_DIR to a directory that already has it.`,
        {
          model: env.rampartModel,
          revision: env.rampartRevision,
          cacheDir: env.rampartCacheDir,
          reason: error instanceof Error ? error.message : String(error),
        },
      )
    },
  )
}
