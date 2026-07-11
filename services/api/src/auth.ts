import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import { Resend } from 'resend'
import type { Pool } from 'pg'
import { appendAuditLog } from './database'
import type { ApiEnv } from './env'
import { magicLinkEmail, resetPasswordEmail, verificationEmail } from './email-templates'

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@')

  if (!localPart || !domain) {
    return 'invalid-email'
  }

  return `${localPart.slice(0, 2)}***@${domain}`
}

/**
 * Shared email sender for all auth-flow emails (magic link, verification,
 * password reset). With OBITER_RESEND_API_KEY configured it sends via
 * Resend (with both html and text parts) and logs + throws on delivery
 * failure (never silently drops an error — better-auth awaits these calls
 * inline for magic-link/reset-request, and in the background for
 * verification email, but either way failures must be visible in server
 * logs since the client-facing response does not reliably surface them).
 * Without a key it falls back to a dev-only console log of the one-time URL.
 */
async function sendEmail(
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
    // Development-only delivery intentionally exposes the one-time URL so a
    // local developer can complete the auth flow without an email provider.
    console.info(`[dev-only] ${options.logLabel} URL (no OBITER_RESEND_API_KEY configured)`, {
      email: maskEmail(options.email),
      url: options.url,
    })
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
      statusCode: (result.error as { statusCode?: number }).statusCode,
      message: result.error.message,
      name: result.error.name,
    })
    throw new Error(`${options.logLabel} email delivery failed: ${result.error.message}`)
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

export async function sendVerificationEmail(env: ApiEnv, email: string, url: string) {
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

export async function sendResetPasswordEmail(env: ApiEnv, email: string, url: string) {
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

export function createAuth(env: ApiEnv, pool: Pool) {
  return betterAuth({
    appName: 'Obiter',
    baseURL: env.authBaseUrl,
    secret: env.authSecret,
    database: pool,
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
      // Enables the forgot/reset-password flow (better-auth 1.6.x):
      // POST /request-password-reset stores a single-use token in the
      // verifications table and calls sendResetPassword; GET /reset-password/:token
      // validates it and redirects to the web with ?token= (or ?error=INVALID_TOKEN);
      // POST /reset-password consumes the token and sets the new password.
      // The request endpoint never reveals whether the email exists. The
      // default 1h token expiry (resetPasswordTokenExpiresIn) is used.
      sendResetPassword: async ({ user, url }) => {
        await sendResetPasswordEmail(env, user.email, url)
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(env, user.email, url)
      },
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
        // Allowed unauthenticated paths that this hook acts on: sign-in
        // (password + magic-link verify) for the sign-in audit log,
        // sign-up/email for the self-registration audit log, and
        // verify-email — since requireEmailVerification means sign-up no
        // longer establishes a session directly, the session (and thus the
        // sign-up audit entry) now lands on verify-email instead. Extend
        // this list deliberately when new auth flows are added.
        const isSignIn = ctx.path === '/sign-in/email' || ctx.path === '/magic-link/verify'
        const isSignUp = ctx.path === '/sign-up/email'
        const isVerifyEmail = ctx.path === '/verify-email'

        if (!isSignIn && !isSignUp && !isVerifyEmail) {
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
          action: isSignUp || isVerifyEmail ? 'auth.sign_up' : 'auth.sign_in',
          metadata: {
            method: ctx.path === '/sign-in/email'
              ? 'email_password'
              : ctx.path === '/sign-up/email' || isVerifyEmail
                ? 'email_password'
                : 'magic_link',
            emailVerified: isVerifyEmail,
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
