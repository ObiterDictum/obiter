import { createClient, getIndexStatus } from '@obiter/search-client'
import { createApiApp, type ApiApp, type ApiRuntimeKind } from './app'
import { createDatabasePools, type DatabasePools } from './database-pools'
import { readApiEnv, type ApiEnv } from './env'
import { runMigrations } from './migrate'
import { warmRedactionDetector } from './redaction-detection'

export interface ApiRuntime {
  env: ApiEnv
  /**
   * The process's one owner of application and corpus pools. Entry points close
   * it through `close()` so a separate corpus reader or writer pool is released
   * exactly once, and a lane configured with a read-only corpus never gets a
   * writer to close.
   */
  pools: DatabasePools
  app: ApiApp
}

/**
 * Raised when boot cannot reach the state serving requires. Entry points turn
 * it into a logged exit; nothing catches it and carries on.
 */
export class ApiBootError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = 'ApiBootError'
  }
}

/**
 * Everything both runtimes do before a socket is bound: configuration,
 * migrations, the application, and the two non-blocking boot probes. This is
 * the one bootstrap; `server.ts` (`@hono/node-server`) and `server-bun.ts`
 * (`Bun.serve`) serve the identical application, so routes, middleware,
 * contracts and database access cannot drift between the adapters.
 */
export async function createApiRuntime(
  runtime: ApiRuntimeKind,
): Promise<ApiRuntime> {
  const env = readApiEnv()
  const pools = createDatabasePools(env)

  try {
    await runMigrations(pools.application)
  } catch (error) {
    await pools.close()
    // Fail closed: handlers assume the latest schema (e.g. sign-up reads the
    // column added in 0016), so serving traffic on a half-migrated database
    // would corrupt per-request state instead of producing one loud boot
    // error. runMigrations holds a Postgres advisory lock, so concurrent
    // instances queue instead of racing.
    throw new ApiBootError(
      'Refusing to start: pending migrations could not be applied.',
      { cause: error },
    )
  }

  // The application pool and the corpus access the process was configured for
  // reach the app through the same boundary. A lane with `CORPUS_DATABASE_URL`
  // and no writer credential gets `corpus.write === null`, so no route can
  // attempt a corpus write or fall back to the application pool.
  const app = createApiApp(env, pools.application, {
    runtime,
    corpus: pools.corpus,
  })

  reportIndexStatus(env)
  warmDetection(env)

  return { env, pools, app }
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
          `Run "bun run prefetch:rampart" to fetch it, or set OBITER_RAMPART_CACHE_DIR to a directory that already has it.`,
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
