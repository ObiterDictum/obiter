import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import { bearer } from 'better-auth/plugins/bearer'
import { Resend } from 'resend'
import type { Pool } from 'pg'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@obiter/contracts'
import { appendAuditLog } from './audit-log'
import { authTrustedOrigins } from './client-origins'
import type { ApiEnv } from './env'
import {
  magicLinkEmail,
  resetPasswordEmail,
  verificationEmail,
} from './email-templates'

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@')

  if (!localPart || !domain) {
    return 'invalid-email'
  }

  return `${localPart.slice(0, 2)}***@${domain}`
}

function errorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined
  }
  const statusCode: unknown = error.statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

export async function sendEmail(
  env: ApiEnv,
  options: {
    email: string
    subject: string
    html: string
    text: string
    logLabel: string
    url: string
  },
) {
  if (!env.resendApiKey) {
    console.info(
      `[dev-only] ${options.logLabel} URL (no OBITER_RESEND_API_KEY configured)`,
      {
        email: maskEmail(options.email),
        url: options.url,
      },
    )
    return
  }

  const resend = new Resend(env.resendApiKey)
  const result = await resend.emails.send({
    from: env.emailFrom,
    to: options.email,
    subject: options.subject,
    html: options.html,
    text: options.text,
  })

  if (result.error) {
    console.error(`[resend] ${options.logLabel} email delivery failed`, {
      email: maskEmail(options.email),
      from: env.emailFrom,
      statusCode: errorStatusCode(result.error),
      message: result.error.message,
      name: result.error.name,
    })
    throw new Error(
      `${options.logLabel} email delivery failed: ${result.error.message}`,
    )
  }
}

export async function sendMagicLink(env: ApiEnv, email: string, url: string) {
  const emailContent = magicLinkEmail(url)
  await sendEmail(env, {
    email,
    url,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    logLabel: 'Magic-link',
  })
}

export async function sendVerificationEmail(
  env: ApiEnv,
  email: string,
  url: string,
) {
  const emailContent = verificationEmail(url)
  await sendEmail(env, {
    email,
    url,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    logLabel: 'Verification',
  })
}

export async function sendResetPasswordEmail(
  env: ApiEnv,
  email: string,
  url: string,
) {
  const emailContent = resetPasswordEmail(url)
  await sendEmail(env, {
    email,
    url,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    logLabel: 'Reset-password',
  })
}

export function resetPasswordUrl(env: ApiEnv, token: string): string {
  return `${env.webOrigin}/reset-password?token=${encodeURIComponent(token)}`
}

interface AuthAuditContext {
  path: string
  newSession: {
    user: { id: string; organisationId?: string | null }
    session: { id: string }
  } | null
}

export interface AuthAuditEvent {
  organisationId: string | null
  userId: string
  entityType: 'session'
  entityId: string
  action: 'auth.sign_in' | 'auth.sign_up'
  metadata: { method: 'email_password' | 'magic_link'; emailVerified: boolean }
}

export function buildAuthAuditEvent(
  ctx: AuthAuditContext,
): AuthAuditEvent | null {
  const isSignIn =
    ctx.path === '/sign-in/email' || ctx.path === '/magic-link/verify'
  const isSignUp = ctx.path === '/sign-up/email'
  const isVerifyEmail = ctx.path === '/verify-email'

  if (!isSignIn && !isSignUp && !isVerifyEmail) {
    return null
  }

  const { newSession } = ctx
  if (!newSession) {
    return null
  }

  return {
    organisationId: newSession.user.organisationId ?? null,
    userId: newSession.user.id,
    entityType: 'session',
    entityId: newSession.session.id,
    action: isSignUp || isVerifyEmail ? 'auth.sign_up' : 'auth.sign_in',
    metadata: {
      method:
        ctx.path === '/magic-link/verify' ? 'magic_link' : 'email_password',
      emailVerified: isVerifyEmail,
    },
  }
}

export async function sendResetPasswordForUser(
  env: ApiEnv,
  email: string,
  token: string,
) {
  try {
    await sendResetPasswordEmail(env, email, resetPasswordUrl(env, token))
  } catch (error) {
    console.error('Reset-password email delivery failed', {
      email: maskEmail(email),
      domain: email.split('@')[1] ?? null,
      requestId: `req_${crypto.randomUUID()}`,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function emailAndPasswordOptions(env: ApiEnv) {
  return {
    enabled: true,
    disableSignUp: false,
    requireEmailVerification: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({
      user,
      token,
    }: {
      user: { email: string }
      token: string
    }) => {
      await sendResetPasswordForUser(env, user.email, token)
    },
  }
}

export type UserAdditionalFields = {
  organisationId: { type: 'string'; required: false; input: false }
  role: { type: ['owner', 'admin', 'member']; required: false; input: false }
  pendingOrganisationName: { type: 'string'; required: false }
}

export function userAdditionalFields(): UserAdditionalFields {
  return {
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
    pendingOrganisationName: {
      type: 'string',
      required: false,
    },
  }
}

export function authPlugins(env: ApiEnv) {
  return [
    bearer(),
    magicLink({
      disableSignUp: true,
      expiresIn: 60 * 10,
      storeToken: 'hashed',
      sendMagicLink: ({ email, url }) => sendMagicLink(env, email, url),
    }),
  ]
}

export function createAuth(env: ApiEnv, pool: Pool) {
  return betterAuth({
    appName: 'Obiter',
    baseURL: env.authBaseUrl,
    secret: env.authSecret,
    trustedOrigins: authTrustedOrigins(env),
    database: pool,
    emailAndPassword: emailAndPasswordOptions(env),
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(env, user.email, url)
      },
    },
    user: {
      modelName: 'users',
      additionalFields: userAdditionalFields(),
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
        const event = buildAuthAuditEvent({
          path: ctx.path,
          newSession: ctx.context.newSession
            ? {
                user: {
                  id: ctx.context.newSession.user.id,
                  organisationId:
                    ctx.context.newSession.user.organisationId ?? null,
                },
                session: { id: ctx.context.newSession.session.id },
              }
            : null,
        })

        if (!event) {
          return
        }

        await appendAuditLog(pool, {
          organisationId: event.organisationId,
          userId: event.userId,
          entityType: event.entityType,
          entityId: event.entityId,
          action: event.action,
          metadata: event.metadata,
          requestId: `req_${crypto.randomUUID()}`,
        })
      }),
    },
    plugins: authPlugins(env),
  })
}
