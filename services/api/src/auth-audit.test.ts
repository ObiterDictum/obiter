import { describe, expect, it } from 'vitest'
import { type Auth, createPool, testEnv } from './app-test-support'
import { createApiApp } from './app'

/**
 * The password-change audit branch at the `/api/auth/*` boundary. A password
 * change is the one auth outcome the session hooks cannot see, so the audit
 * row is written from the response, and the request body must never be read.
 */
describe('POST /api/auth/change-password — audit', () => {
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
})
