import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApiApp } from './app'
import { createAuth } from './auth'
import { createTestApiEnv } from './test-api-env'

/**
 * The password change end to end against real Postgres and real better-auth.
 *
 * A fake pool can show the audit branch was reached; it cannot show that the
 * password actually changed, that the other sessions are gone, or that the
 * caller's replacement session still works after an audit-append failure. This
 * suite drives the HTTP boundary with a live better-auth instance, then checks
 * the database and the auth API for the observable result.
 *
 * The audit insert failing is simulated by routing the app's own pool to a
 * wrapper that rejects that one statement. `auth` keeps the real pool, so only
 * Obiter's audit append fails — exactly the production boundary, where
 * better-auth has already committed the change before the audit runs.
 *
 * Append-only policy: this suite never deletes audit rows. Users and
 * organisations are retained because their audit rows reference them; only
 * synthetic sessions are removed.
 */
describe('password change end to end (Postgres + better-auth)', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for auth-password.db.test.ts (see TESTING.md).',
    )
  }

  const pool = new Pool({ connectionString })
  const env = createTestApiEnv()
  const auth = createAuth(env, pool)
  const seededUserIds: string[] = []
  let counter = 0

  beforeAll(() => {
    // better-auth's verification-email callback logs the one-time URL in a
    // development-style environment; this suite is not about email delivery.
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await pool.query(
        `delete from sessions where "userId" = any($1::text[])`,
        [seededUserIds],
      )
    }
    await pool.end()
  })

  interface SeededUser {
    userId: string
    email: string
    password: string
    organisationId: string
    name: string
  }

  async function createVerifiedUser(): Promise<SeededUser> {
    counter += 1
    const suffix = `${randomUUID().replace(/-/g, '').slice(0, 10)}${counter}`
    const email = `pwd-${suffix}@example.test`
    const password = `original-password-${counter}-value`
    const name = `Password Owner ${counter}`
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name },
    })
    const userId = signUp.user.id
    const organisationId = `org_pwd_${suffix}`
    await pool.query(
      `insert into organisations (id, name, created_at, updated_at)
       values ($1, $2, now(), now())`,
      [organisationId, `Password Org ${suffix}`],
    )
    await pool.query(
      `update users
       set "emailVerified" = true, "organisationId" = $2, role = 'owner'
       where id = $1`,
      [userId, organisationId],
    )
    seededUserIds.push(userId)
    return { userId, email, password, organisationId, name }
  }

  async function signIn(email: string, password: string): Promise<string> {
    const result = await auth.api.signInEmail({ body: { email, password } })
    return result.token
  }

  /** A pool that refuses only Obiter's audit append; better-auth keeps the real one. */
  function poolWithoutPasswordAudit(base: Pool): Pool {
    return {
      query: async (text: unknown, params?: unknown) => {
        if (String(text).includes('insert into audit_logs')) {
          throw new Error('audit insert refused')
        }
        return base.query(text as string, params as unknown[])
      },
      connect: () => base.connect(),
    } as unknown as Pool
  }

  type ApiApp = ReturnType<typeof createApiApp>

  function changePasswordRequest(
    app: ApiApp,
    token: string,
    body: { currentPassword: string; newPassword: string },
  ) {
    return app.request('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        origin: env.webOrigin,
      },
      body: JSON.stringify({ ...body, revokeOtherSessions: true }),
    })
  }

  async function sessionCount(userId: string): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `select count(*)::text as count from sessions where "userId" = $1`,
      [userId],
    )
    return Number(result.rows[0].count)
  }

  async function passwordAuditRows(userId: string) {
    const result = await pool.query<{
      organisation_id: string | null
      metadata_json: unknown
    }>(
      `select organisation_id, metadata_json
       from audit_logs
       where entity_id = $1 and action = 'auth.password_changed'`,
      [userId],
    )
    return result.rows
  }

  function sessionFor(token: string) {
    return auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })
  }

  it('applies the change, revokes the other sessions, and audits exactly once', async () => {
    const user = await createVerifiedUser()
    const currentToken = await signIn(user.email, user.password)
    const otherToken = await signIn(user.email, user.password)
    expect(await sessionCount(user.userId)).toBe(2)

    const app = createApiApp(env, pool, { auth })
    const newPassword = `${user.password}-replaced`
    const response = await changePasswordRequest(app, currentToken, {
      currentPassword: user.password,
      newPassword,
    })

    expect(response.status).toBe(200)

    const audit = await passwordAuditRows(user.userId)
    expect(audit).toHaveLength(1)
    expect(audit[0].organisation_id).toBe(user.organisationId)
    // Identifiers only: no name, no credential material.
    expect(audit[0].metadata_json).toEqual({})

    // The new password works, the old one no longer does.
    await expect(signIn(user.email, newPassword)).resolves.toBeTruthy()
    await expect(signIn(user.email, user.password)).rejects.toThrow()

    // Other sessions are gone; the replacement session issued by the change
    // is the one that survives.
    const replacementToken = response.headers.get('set-auth-token')
    expect(replacementToken).toBeTruthy()
    await expect(sessionFor(otherToken)).resolves.toBeNull()
    const survivor = await sessionFor(replacementToken!)
    expect(survivor?.user.id).toBe(user.userId)

    // A retry from the surviving session with the now-stale password is
    // rejected and adds no second event.
    const retry = await changePasswordRequest(app, replacementToken!, {
      currentPassword: user.password,
      newPassword: `${newPassword}-again`,
    })
    expect(retry.status).toBe(400)
    expect(await passwordAuditRows(user.userId)).toHaveLength(1)
  })

  it('still reports the successful change when the audit append fails', async () => {
    const user = await createVerifiedUser()
    const currentToken = await signIn(user.email, user.password)
    const otherToken = await signIn(user.email, user.password)

    const app = createApiApp(env, poolWithoutPasswordAudit(pool), { auth })
    const newPassword = `${user.password}-after-failure`
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await changePasswordRequest(app, currentToken, {
      currentPassword: user.password,
      newPassword,
    })

    // Truthful success: the mutation committed before the audit was attempted.
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { id: user.userId },
    })

    // The failure is operationally visible with identifiers only.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('auth.password_changed'),
      expect.objectContaining({
        action: 'auth.password_changed',
        userId: user.userId,
        organisationId: user.organisationId,
      }),
    )
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain(user.password)
    expect(logged).not.toContain(newPassword)
    expect(logged).not.toContain(user.name)

    // The change really applied, the other sessions really went, and the
    // caller's replacement session still works.
    expect(await passwordAuditRows(user.userId)).toHaveLength(0)
    await expect(signIn(user.email, newPassword)).resolves.toBeTruthy()
    await expect(signIn(user.email, user.password)).rejects.toThrow()
    await expect(sessionFor(otherToken)).resolves.toBeNull()
    const replacementToken = response.headers.get('set-auth-token')
    expect(replacementToken).toBeTruthy()
    const survivor = await sessionFor(replacementToken!)
    expect(survivor?.user.id).toBe(user.userId)
    errorSpy.mockRestore()
  })

  it('changes nothing and audits nothing when the current password is wrong', async () => {
    const user = await createVerifiedUser()
    const currentToken = await signIn(user.email, user.password)
    await signIn(user.email, user.password)

    const app = createApiApp(env, pool, { auth })
    const response = await changePasswordRequest(app, currentToken, {
      currentPassword: 'definitely-not-the-password',
      newPassword: `${user.password}-never`,
    })

    expect(response.status).toBe(400)
    expect(await passwordAuditRows(user.userId)).toHaveLength(0)
    // Both sessions survive a rejected change.
    expect(await sessionCount(user.userId)).toBe(2)
    await expect(signIn(user.email, user.password)).resolves.toBeTruthy()
    await expect(sessionFor(currentToken)).resolves.toMatchObject({
      user: { id: user.userId },
    })
  })
})
