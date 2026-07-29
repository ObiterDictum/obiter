import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Pool } from 'pg'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  MeResponse,
} from '@obiter/contracts'
import { appendAuditLog, findOrganisation, toCurrentUser } from './database'
import type { ApiEnv } from './env'
import { createAuth } from './auth'
import { corsAllowedOrigin } from './client-origins'
import {
  createLegalSearchRoutes,
  createLegalSearchProxyRoutes,
  createPostgresLegalAuthoritySourceStore,
} from './routes/legal-search'
import { createChangelogRoutes } from './routes/changelog'
import { createDocumentsRoutes } from './routes/documents'
import { createMattersRoutes } from './routes/matters'
import { createOrganisationsRoutes } from './routes/organisations'
import { configureRedactionDetector } from './redaction-detection'
import { createRedactRoutes } from './routes/redact'
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
}

function createRequestId() {
  return `req_${crypto.randomUUID()}`
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  status: 401 | 404 | 500,
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
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.use('*', async (c, next) => {
    c.set('requestId', createRequestId())

    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    })

    c.set('user', session?.user ?? null)
    c.set('session', session?.session ?? null)
    await next()
  })

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

    return response
  })

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      service: 'obiter-api',
    }),
  )

  app.route('/', createMattersRoutes(pool))
  app.route('/', createOrganisationsRoutes(pool))
  app.route('/', createDocumentsRoutes(pool, storage))
  app.route('/', createRedactRoutes(pool, storage))
  app.route('/', createLegalSearchRoutes(env))
  app.route(
    '/',
    createLegalSearchProxyRoutes(
      env,
      createPostgresLegalAuthoritySourceStore(pool),
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
    // Settings (and may not have hit Matters/Redact, which auto-provision a
    // personal workspace). Return organisation null so Settings can offer
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

  return app
}

export type ApiApp = ReturnType<typeof createApiApp>
