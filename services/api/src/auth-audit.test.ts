import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { type Auth, createPool, testEnv } from './app-test-support'
import { createApiApp } from './app'

describe('POST /api/auth/change-password — audit', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('audits a password change without recording any credential material', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.com',
            name: 'User Example',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => Response.json({ user: { id: 'usr_1' } }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'current-secret-value',
        newPassword: 'replacement-secret-value',
        revokeOtherSessions: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      expect.arrayContaining([
        'org_1',
        'usr_1',
        'user',
        'usr_1',
        'auth.password_changed',
      ]),
    ])
    const params = JSON.stringify(queries[0])
    expect(params).not.toContain('current-secret-value')
    expect(params).not.toContain('replacement-secret-value')
  })

  it('does not audit a password change the auth layer rejects', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.com',
            name: 'User Example',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () =>
        Response.json({ message: 'Invalid password' }, { status: 400 }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'wrong',
        newPassword: 'replacement-secret-value',
      }),
    })

    expect(response.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it("keeps the handler's success when the audit append fails", async () => {
    const auditError = new Error('audit store unavailable')
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.com',
            name: 'User Example',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => Response.json({ user: { id: 'usr_1' } }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        queries.push(args)
        const sql = String(args[0])
        expect(sql).toContain('insert into audit_logs')
        throw auditError
      }),
      { auth },
    )

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'current-secret-value',
        newPassword: 'replacement-secret-value',
        revokeOtherSessions: true,
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ user: { id: 'usr_1' } })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message, context] = errorSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(message).toContain('auth.password_changed')
    expect(context).toMatchObject({
      action: 'auth.password_changed',
      userId: 'usr_1',
      organisationId: 'org_1',
      error: 'audit store unavailable',
    })
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('current-secret-value')
    expect(logged).not.toContain('replacement-secret-value')
    expect(logged).not.toContain('User Example')
  })

  it('does not create a second success event when the old password is retried', async () => {
    const inserts: unknown[][] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.com',
            name: 'User Example',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () =>
        inserts.length === 0
          ? Response.json({ user: { id: 'usr_1' } })
          : Response.json({ message: 'Invalid password' }, { status: 400 }),
    } as unknown as Auth

    const app = createApiApp(
      testEnv,
      createPool(async (...args) => {
        inserts.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    const body = JSON.stringify({
      currentPassword: 'current-secret-value',
      newPassword: 'replacement-secret-value',
      revokeOtherSessions: true,
    })
    const first = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const retry = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(first.status).toBe(200)
    expect(retry.status).toBe(400)
    expect(inserts).toHaveLength(1)
    expect(inserts[0][1]).toContain('auth.password_changed')
  })
})
