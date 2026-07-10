import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import { Resend } from 'resend'
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

export async function sendMagicLink(env: ApiEnv, email: string, url: string) {
  if (!env.resendApiKey) {
    // Development-only delivery intentionally exposes the one-time URL so a
    // local developer can complete the auth flow without an email provider.
    console.info('[dev-only] Magic link URL (no OBITER_RESEND_API_KEY configured)', {
      email: maskEmail(email),
      url,
    })
    return
  }

  const resend = new Resend(env.resendApiKey)
  const result = await resend.emails.send({
    from: env.emailFrom,
    to: email,
    subject: 'Your Obiter sign-in link',
    html: `<p>Click the link below to sign in to Obiter:</p><p><a href="${url}">${url}</a></p><p>This link expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
  })

  if (result.error) {
    throw new Error(`Magic-link email delivery failed: ${result.error.message}`)
  }
}

/**
 * Provision a personal/default organisation for a newly self-registered
 * user. Mirrors the shape /api/me expects: users.organisationId set, and
 * role 'owner' since the user is the sole member of their own organisation.
 */
async function provisionOrganisationForNewUser(
  pool: Pool,
  user: { id: string; email: string; organisationId?: string | null },
) {
  if (user.organisationId) {
    return
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    const organisationName = `${user.email.split('@')[0]}'s organisation`
    const organisation = await client.query<{ id: string }>(
      'insert into organisations (name, created_at, updated_at) values ($1, now(), now()) returning id',
      [organisationName],
    )
    await client.query(
      `update users set "organisationId" = $1, role = 'owner', "updatedAt" = now() where id = $2`,
      [organisation.rows[0].id, user.id],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
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
      disableSignUp: false,
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
    databaseHooks: {
      user: {
        create: {
          // Self-registration provisions a personal organisation for the new
          // user, matching the shape /api/me expects (users.organisationId
          // + role). No seed scripts or seeded accounts — every account is
          // created through this path, including the sign-up form.
          after: async (user) => {
            await provisionOrganisationForNewUser(pool, {
              id: user.id,
              email: user.email,
              organisationId: (user as { organisationId?: string | null }).organisationId,
            })
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        // Allowed unauthenticated paths that this hook acts on: sign-in
        // (password + magic-link verify) for the sign-in audit log, and
        // sign-up/email for the self-registration audit log. Extend this
        // list deliberately when new auth flows are added.
        const isSignIn = ctx.path === '/sign-in/email' || ctx.path === '/magic-link/verify'
        const isSignUp = ctx.path === '/sign-up/email'

        if (!isSignIn && !isSignUp) {
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
          action: isSignUp ? 'auth.sign_up' : 'auth.sign_in',
          metadata: {
            method: ctx.path === '/sign-in/email'
              ? 'email_password'
              : ctx.path === '/sign-up/email'
                ? 'email_password'
                : 'magic_link',
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
