import { execFileSync } from 'node:child_process'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Pool } from 'pg'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  MeResponse,
  UpdateProfileResponse,
} from '@obiter/contracts'
import { updateProfileInputSchema } from '@obiter/contracts'
import { updateUserName } from './account-database'
import { appendPasswordChangedAudit } from './auth-change-audit'
import { appendAuditLog } from './audit-log'
import { findOrganisation, toCurrentUser } from './organisation-database'
import { readDatabaseIdentity } from './database-identity'
import type { ApiEnv } from './env'
import type { CorpusAccess } from './database-pools'
import { createAuth } from './auth'
import { corsAllowedOrigin } from './client-origins'
import { createLegalSearchRoutes } from './routes/legal-search/search-routes'
import {
  createLegalSearchProxyRoutes,
  createPostgresLegalAuthorityReadStore,
} from './routes/legal-search/proxy-routes'
import { createChangelogRoutes } from './routes/changelog'
import { createCommentsRoutes } from './routes/comments'
import { createDocumentAccessRoutes } from './routes/document-access'
import { createDocumentCollaborationRoutes } from './routes/document-collaboration'
import { createDocumentCompareRoutes } from './routes/document-compare'
import { createDocumentContentRoutes } from './routes/document-content'
import { createDocumentEditRoutes } from './routes/document-edit'
import { createDocumentExportRoutes } from './routes/document-export'
import { createDocumentMarkingsRoutes } from './routes/document-markings'
import { createDocumentMediaRoutes } from './routes/document-media'
import { createDocumentModelRoutes } from './routes/document-model'
import { createDocumentPdfViewRoutes } from './routes/document-pdf-view'
import { createDocumentsRoutes } from './routes/documents'
import { createMattersRoutes } from './routes/matters'
import { createMatterSavedSourcesRoutes } from './routes/matter-saved-sources'
import { createOrganisationsRoutes } from './routes/organisations'
import { configureRedactionDetector } from './redaction-detection'
import { createRedactRunCreationRoutes } from './routes/redact-run-creation'
import { createRedactReviewRoutes } from './routes/redact-review'
import { createRedactLifecycleRoutes } from './routes/redact-lifecycle'
import {
  createHttpRedactionRenderer,
  type RedactionRenderer,
} from './redaction-renderer'
import { apiRequestLimitsFromEnv } from './request-limits'
import { createRequestBodyLimitMiddleware } from './request-body-limit'
import { createTrackedChangeRoutes } from './routes/tracked-changes'
import { createVerificationRunRoutes } from './routes/verification-runs'
import { PostgresDocumentPresence } from './document-presence-store'
import { createLocalStorage, type StorageService } from './storage'

type Auth = ReturnType<typeof createAuth>
type SessionUser = Auth['$Infer']['Session']['user']
type SessionRecord = Auth['$Infer']['Session']['session']

interface AppVariables {
  requestId: string
  user: SessionUser | null
  session: SessionRecord | null
}

export type ApiRuntimeKind = 'node' | 'bun'

interface ApiAppOptions {
  auth?: Auth
  storage?: StorageService
  redactionRenderer?: RedactionRenderer | null
  runtime?: ApiRuntimeKind
  corpus?: CorpusAccess
}

interface DevelopmentApiProvenance {
  commitSha: string
  checkoutRoot: string
  envFile: string | null
  databaseName: string | null
}

function readDevelopmentApiProvenance(
  envFile: string | null,
  databaseUrl: string,
): DevelopmentApiProvenance | null {
  let databaseName: string | null = null
  try {
    databaseName = readDatabaseIdentity(databaseUrl, 'DATABASE_URL').database
  } catch {}
  try {
    const checkoutRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim()
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim()

    return checkoutRoot && commitSha
      ? { checkoutRoot, commitSha, envFile, databaseName }
      : null
  } catch {
    return null
  }
}

function createRequestId() {
  return `req_${crypto.randomUUID()}`
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  status: 400 | 401 | 404 | 500,
) {
  return {
    response: {
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
  }
}

function requestIdFromContext(c: { var: Partial<AppVariables> }) {
  return c.var.requestId ?? createRequestId()
}

export function createApiApp(
  env: ApiEnv,
  pool: Pool,
  options: ApiAppOptions = {},
) {
  configureRedactionDetector({
    model: env.rampartModel,
    revision: env.rampartRevision,
    cacheDir: env.rampartCacheDir,
    minScore: env.rampartMinScore,
    chunkTokens: env.rampartChunkTokens,
  })
  const auth = options.auth ?? createAuth(env, pool)
  const storage = options.storage ?? createLocalStorage()
  const redactionRenderer =
    options.redactionRenderer !== undefined
      ? options.redactionRenderer
      : env.redactionRendererUrl
        ? createHttpRedactionRenderer({ url: env.redactionRendererUrl })
        : null
  const corpusAccess = options.corpus ?? { read: pool, write: pool }
  const corpusReadOnly = corpusAccess.write === null
  const developmentProvenance =
    env.nodeEnv === 'development'
      ? readDevelopmentApiProvenance(env.localEnvFile, env.databaseUrl)
      : null
  const presence = new PostgresDocumentPresence(pool)
  const requestLimits = apiRequestLimitsFromEnv(env)
  const app = new Hono<{ Variables: AppVariables }>()

  app.onError((error, c) => {
    const requestId = requestIdFromContext(c)
    console.error('Unhandled API error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })

    const response: ApiErrorResponse = {
      error: {
        code: 'storage_unavailable',
        message: 'The API could not complete the request.',
        requestId,
      },
    }

    return c.json(response, 500)
  })

  app.use(
    '*',
    cors({
      origin: (origin) => corsAllowedOrigin(env, origin),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.use('*', async (c, next) => {
    c.set('requestId', createRequestId())
    await next()
  })

  app.use('*', async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    })

    c.set('user', session?.user ?? null)
    c.set('session', session?.session ?? null)
    await next()
  })
  app.use('*', createRequestBodyLimitMiddleware(requestLimits))

  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    const requestId = c.get('requestId')
    const sessionUser = c.get('user')
    const session = c.get('session')
    const response = await auth.handler(c.req.raw)

    if (
      c.req.method === 'POST' &&
      c.req.path === '/api/auth/sign-out' &&
      response.ok &&
      sessionUser &&
      session
    ) {
      await appendAuditLog(pool, {
        organisationId: sessionUser.organisationId ?? null,
        userId: sessionUser.id,
        entityType: 'session',
        entityId: session.id,
        action: 'auth.sign_out',
        metadata: {
          client: c.req.header('user-agent') ?? null,
        },
        requestId,
      })
    }

    if (
      c.req.method === 'POST' &&
      c.req.path === '/api/auth/change-password' &&
      response.ok &&
      sessionUser
    ) {
      await appendPasswordChangedAudit(pool, {
        organisationId: sessionUser.organisationId ?? null,
        userId: sessionUser.id,
        requestId,
      })
    }

    return response
  })

  app.get('/api/health', (c) => {
    const health = {
      status: 'ok' as const,
      service: 'obiter-api' as const,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      corpus: {
        colocated: corpusAccess.read === pool,
        readOnly: corpusReadOnly,
      },
    }

    return developmentProvenance
      ? c.json({ ...health, provenance: developmentProvenance })
      : c.json(health)
  })

  app.route('/', createMattersRoutes(pool))
  app.route('/', createMatterSavedSourcesRoutes(pool))
  app.route('/', createCommentsRoutes(pool, storage))
  app.route('/', createDocumentAccessRoutes(pool))
  app.route('/', createOrganisationsRoutes(pool, env))
  app.route('/', createDocumentsRoutes(pool, storage, requestLimits))
  app.route('/', createDocumentCollaborationRoutes(pool, storage, presence))
  app.route('/', createDocumentCompareRoutes(pool, storage))
  app.route('/', createDocumentContentRoutes(pool, storage))
  app.route('/', createDocumentEditRoutes(pool, storage))
  app.route('/', createDocumentModelRoutes(pool, storage))
  app.route('/', createDocumentExportRoutes(pool, storage))
  app.route('/', createDocumentMarkingsRoutes(pool, storage))
  app.route('/', createDocumentMediaRoutes(pool, storage))
  app.route('/', createDocumentPdfViewRoutes(pool, storage))
  app.route('/', createTrackedChangeRoutes(pool, storage))
  app.route('/', createRedactRunCreationRoutes(pool, storage, requestLimits))
  app.route(
    '/',
    createRedactReviewRoutes(pool, storage, redactionRenderer, requestLimits),
  )
  app.route('/', createRedactLifecycleRoutes(pool, storage))
  app.route('/', createVerificationRunRoutes(pool, storage, corpusAccess.read))
  app.route('/', createLegalSearchRoutes(env))
  app.route(
    '/',
    createLegalSearchProxyRoutes(
      env,
      createPostgresLegalAuthorityReadStore(corpusAccess.read),
      {
        legislation: {
          pool: corpusAccess.read,
          indexName: env.legislationProvisionsIndex,
        },
      },
    ),
  )
  app.route('/', createChangelogRoutes())

  app.get('/api/me', async (c) => {
    const requestId = c.get('requestId')
    const sessionUser = c.get('user')
    const session = c.get('session')

    if (!sessionUser || !session) {
      const error = errorResponse(
        'unauthenticated',
        'Sign in is required.',
        requestId,
        401,
      )
      return c.json(error.response, error.status)
    }

    const currentUser = toCurrentUser(sessionUser)
    const organisationId = sessionUser.organisationId

    if (!organisationId) {
      const response: MeResponse = {
        user: currentUser,
        organisation: null,
      }
      return c.json(response)
    }

    const organisation = await findOrganisation(pool, organisationId)

    if (!organisation) {
      const error = errorResponse(
        'organisation_not_found',
        'The signed-in user does not have an active organisation.',
        requestId,
        404,
      )
      return c.json(error.response, error.status)
    }

    const response: MeResponse = {
      user: currentUser,
      organisation,
    }

    return c.json(response)
  })

  app.patch('/api/me', async (c) => {
    const requestId = c.get('requestId')
    const sessionUser = c.get('user')
    const session = c.get('session')

    if (!sessionUser || !session) {
      const error = errorResponse(
        'unauthenticated',
        'Sign in is required.',
        requestId,
        401,
      )
      return c.json(error.response, error.status)
    }

    const body: unknown = await c.req.json().catch(() => null)
    const parsed = updateProfileInputSchema.safeParse(body)
    if (!parsed.success) {
      const error = errorResponse(
        'validation_failed',
        parsed.error.issues[0]?.message ?? 'Name is required.',
        requestId,
        400,
      )
      return c.json(error.response, error.status)
    }

    const user = await updateUserName(pool, {
      userId: sessionUser.id,
      organisationId: sessionUser.organisationId ?? null,
      name: parsed.data.name,
      requestId,
    })

    if (!user) {
      const error = errorResponse(
        'unauthenticated',
        'Your account is no longer available.',
        requestId,
        401,
      )
      return c.json(error.response, error.status)
    }

    const response: UpdateProfileResponse = { user }
    return c.json(response)
  })

  return app
}

export type ApiApp = ReturnType<typeof createApiApp>
