import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Pool } from 'pg'
import type { ApiErrorCode, ApiErrorResponse, MeResponse } from '@obiter/contracts'
import { appendAuditLog, findOrganisation, toCurrentUser } from './database'
import type { ApiEnv } from './env'
import { createAuth } from './auth'
import {
  createLegalSearchRoutes,
  createLegalSearchProxyRoutes,
  createPostgresLegalAuthoritySourceStore,
} from './routes/legal-search'
import { createChangelogRoutes } from './routes/changelog'
import { createDocumentsRoutes } from './routes/documents'
import { createMattersRoutes } from './routes/matters'
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

export function createApiApp(env: ApiEnv, pool: Pool, options: ApiAppOptions = {}) {
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
      origin: [env.webOrigin, env.authBaseUrl, env.desktopOrigin, env.marketingOrigin].filter(
        (origin): origin is string => Boolean(origin),
      ),
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
      new URL(c.req.url).pathname === '/api/auth/sign-out' &&
      response.ok &&
      sessionUser?.organisationId &&
      session
    ) {
      await appendAuditLog(pool, {
        organisationId: sessionUser.organisationId,
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
  app.route('/', createDocumentsRoutes(pool))
  app.route('/', createRedactRoutes(pool, storage))
  app.route('/', createLegalSearchRoutes(env))
  app.route('/', createLegalSearchProxyRoutes(env, createPostgresLegalAuthoritySourceStore(pool)))
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

    if (!currentUser || !organisationId) {
      const error = errorResponse(
        'organisation_not_found',
        'The signed-in user does not have an active organisation.',
        requestId,
        404,
      )
      return c.json(error.response, error.status)
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

  return app
}

export type ApiApp = ReturnType<typeof createApiApp>
