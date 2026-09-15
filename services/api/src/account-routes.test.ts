import { describe, expect, it } from 'vitest'
import { type Auth, createConnectedPool, testEnv } from './app-test-support'
import { createApiApp } from './app'

/**
 * The account name route, `PATCH /api/me`, against a fake pool. The statement
 * the route builds is pinned here; `account.db.test.ts` runs the same route
 * against real Postgres, which is what proves the SQL scopes the write to the
 * caller's own row.
 */
describe('PATCH /api/me — account name', () => {
  it('updates the signed-in account name through PATCH /api/me', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.test',
            name: 'Old Name',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        if (String(args[0]).includes('update users')) {
          return {
            rows: [
              {
                id: 'usr_1',
                email: 'user@example.test',
                name: 'Ada Lovelace',
                role: 'owner',
              },
            ],
          }
        }
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Ada Lovelace  ', id: 'usr_2' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'usr_1',
        email: 'user@example.test',
        name: 'Ada Lovelace',
        role: 'owner',
      },
    })

    const update = queries.find((args) =>
      String((args as unknown[])[0]).includes('update users'),
    ) as unknown[]
    // A client-supplied id in the body must never widen the update scope.
    expect(update[1]).toEqual(['usr_1', 'Ada Lovelace'])
    expect(JSON.stringify(update[1])).not.toContain('usr_2')
  })

  it('refuses a blank or over-long account name at PATCH /api/me', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.test',
            name: 'User',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        return { rows: [] }
      }),
      { auth },
    )

    for (const name of ['   ', '\u200b\u200b', 'x'.repeat(121)]) {
      const response = await app.request('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'validation_failed' },
      })
    }

    expect(
      queries.some((args) =>
        String((args as unknown[])[0]).includes('update users'),
      ),
    ).toBe(false)
  })

  it('refuses an account name update without a session', async () => {
    const auth = {
      api: { getSession: async () => null },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createConnectedPool(async () => {
        throw new Error(
          'An unauthenticated request must not reach the database.',
        )
      }),
      { auth },
    )

    const response = await app.request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthenticated' },
    })
  })

  it('audits an account name change without recording either name', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.test',
            name: 'Old Name',
            organisationId: 'org_1',
            role: 'owner',
          },
          session: { id: 'ses_1' },
        }),
      },
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as Auth
    const app = createApiApp(
      testEnv,
      createConnectedPool(async (...args) => {
        queries.push(args)
        if (String(args[0]).includes('update users')) {
          return {
            rows: [
              {
                id: 'usr_1',
                email: 'user@example.test',
                name: 'Ada Lovelace',
                role: 'owner',
              },
            ],
          }
        }
        return { rows: [] }
      }),
      { auth },
    )

    const response = await app.request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    })

    expect(response.status).toBe(200)
    const audit = queries.find((args) =>
      String((args as unknown[])[0]).includes('insert into audit_logs'),
    ) as unknown[]
    expect(audit).toBeDefined()
    expect(audit[1]).toContain('user.profile_update')
    expect(audit[1]).toContain('usr_1')
    expect(JSON.stringify(audit[1])).not.toContain('Ada Lovelace')
    expect(JSON.stringify(audit[1])).not.toContain('Old Name')
  })

  // Audit records are append-only (docs/prds/archive/platform-deletion.md §2):
  // no route may delete or rewrite them. This pins that for the write paths
  // this surface adds, so a future cleanup cannot quietly reach the table.
  it('issues no statement that deletes or updates audit records', async () => {
    const queries: unknown[] = []
    const auth = {
      api: {
        getSession: async () => ({
          user: {
            id: 'usr_1',
            email: 'user@example.test',
            name: 'Ada Lovelace',
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
      createConnectedPool(async (...args) => {
        queries.push(args)
        if (String(args[0]).includes('update users')) {
          return {
            rows: [
              {
                id: 'usr_1',
                email: 'user@example.test',
                name: 'Ada Lovelace',
                role: 'owner',
              },
            ],
          }
        }
        return { rows: [] }
      }),
      { auth },
    )

    await app.request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    })
    await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'current-secret-value',
        newPassword: 'replacement-secret-value',
      }),
    })

    const statements = queries.map((args) => String((args as unknown[])[0]))
    expect(statements.length).toBeGreaterThan(0)
    expect(
      statements.filter((sql) =>
        /\b(?:delete\s+from|update|truncate)\s+audit_logs\b/i.test(sql),
      ),
    ).toEqual([])
  })
})
