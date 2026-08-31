import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import { bearer } from 'better-auth/plugins/bearer'
import { Resend } from 'resend'
import type { Pool } from 'pg'
import { appendAuditLog } from './database'
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
    // Development-only delivery intentionally exposes the one-time URL so a
    // local developer can complete the auth flow without an email provider.
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
      statusCode: (result.error as { statusCode?: number }).statusCode,
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

/**
 * Builds the reset link a user follows from the password-reset email. The URL
 * always targets the configured web origin (OBITER_WEB_ORIGIN) — never the
 * client that requested the reset — so desktop renderer requests (whose
 * origin is a custom scheme) still produce a link that opens in a browser at
 * the web app's /reset-password screen, which reads ?token=.
 */
export function resetPasswordUrl(env: ApiEnv, token: string): string {
  return `${env.webOrigin}/reset-password?token=${encodeURIComponent(token)}`
}

/**
 * The subset of a better-auth hook context that drives the auth-audit
 * decision. Kept structural so the pure helper can be tested without a live
 * better-auth instance.
 */
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

/**
 * Pure decision: for a given post-auth path and resulting session, return the
 * audit event to record (or null when the path is not audited or no session
 * was established). Org-less users are auditable too — their event carries
 * `organisationId: null` (audit_logs.organisation_id is nullable since
 * migration 0009). Kept separate from the better-auth hook so it is testable
 * without booting the auth instance.
 */
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

/**
 * Sends the password-reset email for a given user+token. better-auth runs the
 * `sendResetPassword` callback in the background after the reset token is
 * already stored, so an unhandled throw here is swallowed and the client
 * always sees "email sent" — correct for account-existence privacy, but it
 * means a delivery failure would be invisible. This wrapper catches the
 * failure and logs it at error level (masked email, domain, requestId) so
 * delivery problems are observable in server logs, without changing the
 * client-facing response.
 */
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

/**
 * The emailAndPassword config, exported so its security-relevant options can be
 * regression-tested without booting a better-auth instance (which would need a
 * DB). `revokeSessionsOnPasswordReset` must stay true: it is the only thing
 * that makes better-auth call `deleteSessions(userId)` on reset, closing the
 * "stolen session cookie survives a password reset" threat.
 */
export function emailAndPasswordOptions(env: ApiEnv) {
  return {
    enabled: true,
    disableSignUp: false,
    requireEmailVerification: true,
    // Revoke every existing session when a password is reset: an attacker
    // who holds a stolen session cookie is signed out the moment the victim
    // resets their password, so the stolen credential stops working.
    // better-auth's default is falsy (deleteSessions does not run).
    revokeSessionsOnPasswordReset: true,
    // Enables the forgot/reset-password flow (better-auth 1.6.x):
    // POST /request-password-reset stores a single-use token in the
    // verifications table and calls this callback; POST /reset-password
    // consumes the token and sets the new password. The request endpoint
    // never reveals whether the email exists. The default 1h token expiry
    // (resetPasswordTokenExpiresIn) is used.
    //
    // The reset link is built server-side from the raw token to always
    // point at the configured web origin (resetPasswordUrl), regardless of
    // which client requested the reset. better-auth's own GET
    // /reset-password/:token pre-validation redirect is deliberately
    // bypassed: the email links straight to the web app's /reset-password
    // screen with ?token=, where the token is validated on submit. An
    // expired/invalid token therefore surfaces at submit time, not up-front
    // — the reset screen renders its "request a new link" state on that
    // failure. This avoids reset links that target the desktop custom
    // scheme, which would not open in a browser.
    sendResetPassword: async ({
      user,
      token,
    }: {
      user: { email: string }
      token: string
    }) => {
      // Delegates to sendResetPasswordForUser, which logs delivery failures
      // at error level instead of letting better-auth swallow the throw.
      await sendResetPasswordForUser(env, user.email, token)
    },
  }
}

/**
 * Auth plugins kept separate from createAuth so configuration can be regression
 * tested without initializing better-auth's asynchronous database adapter.
 */
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
    // CSRF / Origin check. baseURL alone only trusts BETTER_AUTH_URL (web);
    // desktop Electron in dev sends Origin: http://localhost:5173 (Vite).
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
        // Auth audit covers sign-in, sign-up, and verify-email. The decision
        // (which paths audit, and the action/method mapping) lives in the pure
        // buildAuthAuditEvent helper; this hook just applies it. Org-less
        // users are audited with organisationId null — the primary
        // registration/sign-in path is no longer invisible to the audit log.
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
