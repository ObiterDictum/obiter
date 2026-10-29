import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { createTestPool } from './test-database.test-support'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { createApiApp } from './app'
import { createAuth } from './auth'
import { createTestApiEnv } from './test-api-env'

describe('password change end to end (Postgres + better-auth)', () => {
  const pool = createTestPool()
  const env = createTestApiEnv()
  const auth = createAuth(env, pool)
  const seededUserIds: string[] = []
  let counter = 0

  beforeAll(() => {
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
    expect(audit[0].metadata_json).toEqual({})

    await expect(signIn(user.email, newPassword)).resolves.toBeTruthy()
    await expect(signIn(user.email, user.password)).rejects.toThrow()

    const replacementToken = response.headers.get('set-auth-token')
    expect(replacementToken).toBeTruthy()
    await expect(sessionFor(otherToken)).resolves.toBeNull()
    const survivor = await sessionFor(replacementToken!)
    expect(survivor?.user.id).toBe(user.userId)

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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { id: user.userId },
    })

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
    expect(await sessionCount(user.userId)).toBe(2)
    await expect(signIn(user.email, user.password)).resolves.toBeTruthy()
    await expect(sessionFor(currentToken)).resolves.toMatchObject({
      user: { id: user.userId },
    })
  })
})
