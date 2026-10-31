import { createClient, getIndexStatus } from '@obiter/search-client'
import { createApiApp, type ApiApp, type ApiRuntimeKind } from './app'
import { createDatabasePools, type DatabasePools } from './database-pools'
import { readApiEnv, type ApiEnv } from './env'
import { runMigrations } from './migrate'
import { createLocalStorage } from './storage'
import { startDetectionWorker } from './redaction-detection-jobs'
import { apiRequestLimitsFromEnv } from './request-limits'
import { warmRedactionDetector } from './redaction-detection'

export interface ApiRuntime {
  env: ApiEnv
  pools: DatabasePools
  app: ApiApp
  stopDetectionWorker: () => Promise<void>
}

export class ApiBootError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = 'ApiBootError'
  }
}

export async function createApiRuntime(
  runtime: ApiRuntimeKind,
): Promise<ApiRuntime> {
  const env = readApiEnv()
  const pools = createDatabasePools(env)

  try {
    await runMigrations(pools.application)
  } catch (error) {
    await pools.close()
    throw new ApiBootError(
      'Refusing to start: pending migrations could not be applied.',
      { cause: error },
    )
  }

  const storage = createLocalStorage()
  const app = createApiApp(env, pools.application, {
    storage,
    runtime,
    corpus: pools.corpus,
  })

  reportIndexStatus(env)
  warmDetection(env)

  const worker = startDetectionWorker(
    pools.application,
    storage,
    apiRequestLimitsFromEnv(env),
  )
  return { env, pools, app, stopDetectionWorker: worker.stop }
}

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
