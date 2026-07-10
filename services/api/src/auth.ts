import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import type { Pool } from 'pg'
import { appendAuditLog } from './database'
import type { ApiEnv } from './env'

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@')

  if (!localPart || !domain) {
    return 'invalid-email'
  }

  return `${localPart.slice(0, 2)}***@${domain}`
}

async function sendMagicLink(env: ApiEnv, email: string, url: string) {
  if (!env.magicLinkWebhookUrl && env.nodeEnv === 'development') {
    // Development-only delivery intentionally exposes the one-time URL so a
    // local developer can complete the auth flow without an email provider.
    console.info('Development magic link URL', { email: maskEmail(email), url })
    return
  }

  if (!env.magicLinkWebhookUrl || !env.magicLinkWebhookSecret) {
    throw new Error('Magic-link email transport is not configured.')
  }

  const response = await fetch(env.magicLinkWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.magicLinkWebhookSecret}`,
    },
    body: JSON.stringify({
      email,
      url,
    }),
  })

  if (!response.ok) {
    throw new Error(`Magic-link email transport failed with status ${response.status}.`)
  }
}

export function createAuth(env: ApiEnv, pool: Pool) {
  return betterAuth({
    appName: 'Obiter',
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
        sendMagicLink: ({ email, url }) => sendMagicLink(env, email, url),
      }),
    ],
  })
}
