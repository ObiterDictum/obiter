import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Pool } from 'pg'
import type { MeResponse } from '@ormont/contracts'
import { appendAuditLog, findOrganisation, toCurrentUser } from './database'
import type { ApiEnv } from './env'
import { createAuth } from './auth'

type Auth = ReturnType<typeof createAuth>
type SessionUser = Auth['$Infer']['Session']['user']
type SessionRecord = Auth['$Infer']['Session']['session']

interface AppVariables {
  requestId: string
  user: SessionUser | null
  session: SessionRecord | null
}

function createRequestId() {
  return `req_${crypto.randomUUID()}`
}

function errorResponse(
  code: 'unauthenticated' | 'organisation_not_found',
  message: string,
  requestId: string,
  status: 401 | 404,
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

export function createApiApp(env: ApiEnv, pool: Pool) {
  const auth = createAuth(env, pool)
  const app = new Hono<{ Variables: AppVariables }>()

  app.use(
    '*',
    cors({
      origin: [env.webOrigin, env.authBaseUrl],
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

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      service: 'ormont-api',
    }),
  )

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

  app.post('/api/session/sign-out-audit', async (c) => {
    const requestId = c.get('requestId')
    const sessionUser = c.get('user')
    const session = c.get('session')

    if (!sessionUser || !session || !sessionUser.organisationId) {
      const error = errorResponse(
        'unauthenticated',
        'Sign in is required.',
        requestId,
        401,
      )
      return c.json(error.response, error.status)
    }

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

    return c.json({ ok: true })
  })

  return app
}

export type ApiApp = ReturnType<typeof createApiApp>
