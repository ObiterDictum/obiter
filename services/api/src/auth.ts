import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import type { Pool } from 'pg'
import { appendAuditLog } from './database'
import type { ApiEnv } from './env'

export function createAuth(env: ApiEnv, pool: Pool) {
  return betterAuth({
    appName: 'Ormont',
    baseURL: env.authBaseUrl,
    secret: env.authSecret,
    database: pool,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    user: {
      modelName: 'users',
      additionalFields: {
        organisationId: {
          type: 'string',
          required: false,
          input: false,
        },
        role: {
          type: ['owner', 'admin', 'member'],
          required: false,
          input: false,
        },
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: 'accounts',
    },
    verification: {
      modelName: 'verifications',
      storeIdentifier: 'hashed',
      storeInDatabase: true,
    },
    advanced: {
      useSecureCookies: env.nodeEnv === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.nodeEnv === 'production',
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email' && ctx.path !== '/magic-link/verify') {
          return
        }

        const newSession = ctx.context.newSession
        const organisationId = newSession?.user.organisationId

        if (!newSession || !organisationId) {
          return
        }

        await appendAuditLog(pool, {
          organisationId,
          userId: newSession.user.id,
          entityType: 'session',
          entityId: newSession.session.id,
          action: 'auth.sign_in',
          metadata: {
            method: ctx.path === '/sign-in/email' ? 'email_password' : 'magic_link',
          },
          requestId: `req_${crypto.randomUUID()}`,
        })
      }),
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: 60 * 10,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          if (env.nodeEnv !== 'development') {
            throw new Error('Magic-link email transport is not configured.')
          }

          console.info('Development magic link requested', {
            email,
            url,
          })
        },
      }),
    ],
  })
}
