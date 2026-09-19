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
import { appendAuditLog, findOrganisation, toCurrentUser } from './database'
import type { ApiEnv } from './env'
import type { CorpusAccess } from './database-pools'
import { createAuth } from './auth'
import { corsAllowedOrigin } from './client-origins'
import { createLegalSearchRoutes } from './routes/legal-search/search-routes'
import {
  createLegalSearchProxyRoutes,
  createPostgresLegalAuthorityReadStore,
  createPostgresLegalAuthorityWriteStore,
} from './routes/legal-search/proxy-routes'
import { createChangelogRoutes } from './routes/changelog'
import { createCommentsRoutes } from './routes/comments'
import { createDocumentAccessRoutes } from './routes/document-access'
import { createDocumentCollaborationRoutes } from './routes/document-collaboration'
import { createDocumentContentRoutes } from './routes/document-content'
import { createDocumentEditRoutes } from './routes/document-edit'
import { createDocumentExportRoutes } from './routes/document-export'
import { createDocumentMediaRoutes } from './routes/document-media'
import { createDocumentModelRoutes } from './routes/document-model'
import { createDocumentPdfViewRoutes } from './routes/document-pdf-view'
import { createDocumentsRoutes } from './routes/documents'
import { createMattersRoutes } from './routes/matters'
import { createOrganisationsRoutes } from './routes/organisations'
import { configureRedactionDetector } from './redaction-detection'
import { createRedactRunCreationRoutes } from './routes/redact-run-creation'
import { createRedactReviewRoutes } from './routes/redact-review'
import { createRedactLifecycleRoutes } from './routes/redact-lifecycle'
import { apiRequestLimitsFromEnv } from './request-limits'
import { createRequestBodyLimitMiddleware } from './request-body-limit'
import { createTrackedChangeRoutes } from './routes/tracked-changes'
import { createVerificationRunRoutes } from './routes/verification-runs'
import { DocumentPresenceRegistry } from './document-presence'
import { createLocalStorage, type StorageService } from './storage'

type Auth = ReturnType<typeof createAuth>
type SessionUser = Auth['$Infer']['Session']['user']
type SessionRecord = Auth['$Infer']['Session']['session']

interface AppVariables {
  requestId: string
  user: SessionUser | null
  session: SessionRecord | null
}

interface ApiAppOptions {
  auth?: Auth
  storage?: StorageService
  /**
   * Legal-corpus access. Omitted in the default configuration, where the
   * corpus is the application database and reads and writes both use `pool`.
   * A read-only corpus access is what a process pointed at a separate corpus
   * has: reads run there, and no corpus write is reachable from this app.
   */
  corpus?: CorpusAccess
}

interface DevelopmentApiProvenance {
  commitSha: string
  checkoutRoot: string
  envFile: string | null
}

function readDevelopmentApiProvenance(
  envFile: string | null,
): DevelopmentApiProvenance | null {
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
      ? { checkoutRoot, commitSha, envFile }
      : null
  } catch {
    // A source checkout is expected in development, but health must remain
    // useful when the process is started without git metadata.
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
  // The default is the compatibility seam: corpus reads and writes are the
  // application pool, exactly as they were before the seam existed.
  const corpusAccess = options.corpus ?? { pool, readOnly: false }
  // This is deliberately development-only: the public health route must not
  // expose filesystem paths or build metadata in production.
  const developmentProvenance =
    env.nodeEnv === 'development'
      ? readDevelopmentApiProvenance(env.localEnvFile)
      : null
  const presence = new DocumentPresenceRegistry()
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
        // Org-less users can sign out too; the audit row carries null org,
        // consistent with the nullable audit_logs.organisation_id (migration
        // 0009) and the auth sign-in/sign-up audit rows.
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

    // A password change is the one auth outcome the session hooks above cannot
    // see: better-auth's after-hook reports sign-in/sign-up, and a successful
    // change returns a user object, not a session. Audited here, at the same
    // boundary, after the change has been applied. The request body is never
    // read, so no password material can reach the audit row or the logs.
    //
    // The change is already committed inside `auth.handler` — password
    // updated, other sessions revoked, replacement session minted — so the
    // audit append is deliberately non-fatal: `appendPasswordChangedAudit`
    // reports its own failure without turning a completed credential mutation
    // into a false 500. Invariant kept: this branch is reached only on
    // `response.ok`, so a rejected change can never mint a success event.
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
      // The corpus access mode: whether corpus reads share the application pool
      // (`colocated`, the compatibility default) and whether this process may
      // write the corpus. `colocated: true` means no separate corpus target was
      // configured, so there is one database and corpus writes behave exactly
      // as they did before the seam. The mode follows configuration, not URL
      // equality: a configured target is read-only even when it names the same
      // database. It says nothing about whether a shared corpus exists; no
      // shared corpus is deployed, and this reports only what this process is
      // configured to do. Deliberately no host, port or database name: the
      // booleans are enough to tell the modes apart and disclose no connection
      // detail.
      corpus: {
        colocated: corpusAccess.pool === pool,
        readOnly: corpusAccess.readOnly,
      },
    }

    return developmentProvenance
      ? c.json({ ...health, provenance: developmentProvenance })
      : c.json(health)
  })

  app.route('/', createMattersRoutes(pool))
  app.route('/', createCommentsRoutes(pool, storage))
  app.route('/', createDocumentAccessRoutes(pool))
  app.route('/', createOrganisationsRoutes(pool, env))
  app.route('/', createDocumentsRoutes(pool, storage, requestLimits))
  app.route('/', createDocumentCollaborationRoutes(pool, storage, presence))
  app.route('/', createDocumentContentRoutes(pool, storage))
  app.route('/', createDocumentEditRoutes(pool, storage))
  app.route('/', createDocumentModelRoutes(pool, storage))
  app.route('/', createDocumentExportRoutes(pool, storage))
  app.route('/', createDocumentMediaRoutes(pool, storage))
  app.route('/', createDocumentPdfViewRoutes(pool, storage))
  app.route('/', createTrackedChangeRoutes(pool, storage))
  app.route('/', createRedactRunCreationRoutes(pool, storage, requestLimits))
  app.route('/', createRedactReviewRoutes(pool, storage))
  app.route('/', createRedactLifecycleRoutes(pool, storage))
  app.route('/', createVerificationRunRoutes(pool, storage, corpusAccess.pool))
  app.route('/', createLegalSearchRoutes(env))
  app.route(
    '/',
    createLegalSearchProxyRoutes(
      env,
      createPostgresLegalAuthorityReadStore(corpusAccess.pool),
      {
        // The write half is handed over only when the corpus is writable here.
        // A read-only process is never given one, so no route can attempt a
        // corpus write and then have to swallow the failure.
        corpusWrites: corpusAccess.readOnly
          ? null
          : createPostgresLegalAuthorityWriteStore(corpusAccess.pool),
        legislation: {
          pool: corpusAccess.pool,
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

    // Org-less users (organisationId null) are a first-class state: the user
    // exists and is authenticated but has not yet named an organisation in
    // Settings (and may not have hit Matters/Redact, which auto-provision on
    // first use). Return organisation null so Settings can offer
    // optional setup; product surfaces do not require it first.
    if (!organisationId) {
      const response: MeResponse = {
        user: currentUser,
        organisation: null,
      }
      return c.json(response)
    }

    const organisation = await findOrganisation(pool, organisationId)

    // The user has an organisationId but the row is missing — a data
    // integrity problem, not the normal org-less state. Surface it distinctly.
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

  /**
   * The signed-in account's own display name. There is no user id in the path
   * or the body: the update scope is the session's user, so a request cannot
   * name a different account. The response is the canonical stored user, so the
   * client shows what the server kept rather than what it typed.
   */
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

    // The session user exists, so a missing row means the session outlived its
    // user; the session is no longer usable.
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
