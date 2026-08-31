import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import type { MatterAccessLevel, UserRole } from '@obiter/contracts'
import type { AuthenticatedOrgUser, AuthzVariables } from './authz'
import { requireMatterAccess, resolveMatterAccess } from './document-access'

interface MatterFixture {
  id: string
  organisationId: string
  ownerUserId: string
  deleted?: boolean
}

function accessPool(
  matters: MatterFixture[],
  grants: Map<string, MatterAccessLevel> = new Map(),
) {
  const calls: Array<{ sql: string; parameters: unknown[] }> = []
  const pool = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      const [matterId, organisationId, userId] = parameters as string[]
      const matter = matters.find(
        (candidate) =>
          candidate.id === matterId &&
          candidate.organisationId === organisationId &&
          !candidate.deleted,
      )
      if (!matter) return { rows: [] }
      return {
        rows: [
          {
            created_by: matter.ownerUserId,
            access_level: grants.get(`${matter.id}:${userId}`) ?? null,
          },
        ],
      }
    },
  } as unknown as Pool
  return { pool, calls }
}

function user(
  id: string,
  role: UserRole = 'member',
  organisationId = 'org_1',
): AuthenticatedOrgUser {
  return { id, organisationId, role }
}

function requirementApp(
  pool: Pool,
  routeUser: AuthenticatedOrgUser,
  requiredLevel: MatterAccessLevel,
) {
  const app = new Hono<{ Variables: AuthzVariables }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_access')
    c.set('user', routeUser)
    await next()
  })
  app.get('/matters/:matterId', async (c) => {
    const permitted = await requireMatterAccess(
      c,
      pool,
      c.req.param('matterId'),
      requiredLevel,
    )
    if (permitted instanceof Response) return permitted
    return c.json({ userId: permitted.id })
  })
  return app
}

describe('resolveMatterAccess', () => {
  const matter: MatterFixture = {
    id: 'mtr_1',
    organisationId: 'org_1',
    ownerUserId: 'usr_owner',
  }
  const grants = new Map<string, MatterAccessLevel>([
    ['mtr_1:usr_editor', 'edit'],
    ['mtr_1:usr_viewer', 'view'],
  ])

  it.each([
    ['owner view', user('usr_owner'), 'view', 'edit'],
    ['owner edit', user('usr_owner'), 'edit', 'edit'],
    ['edit grantee view', user('usr_editor'), 'view', 'edit'],
    ['edit grantee edit', user('usr_editor'), 'edit', 'edit'],
    ['view grantee view', user('usr_viewer'), 'view', 'view'],
    ['view grantee edit', user('usr_viewer'), 'edit', 'denied'],
    ['non-grantee', user('usr_other'), 'view', 'denied'],
    [
      'administrator without grant',
      user('usr_admin', 'admin'),
      'view',
      'denied',
    ],
  ] as const)(
    '%s resolves to %s',
    async (_name, caller, required, expected) => {
      const { pool } = accessPool([matter], grants)

      await expect(
        resolveMatterAccess(pool, caller, 'mtr_1', required),
      ).resolves.toBe(expected)
    },
  )

  it.each([
    ['unknown matter', 'mtr_unknown', user('usr_owner')],
    [
      'cross-organisation matter',
      'mtr_1',
      user('usr_owner', 'member', 'org_2'),
    ],
    ['soft-deleted matter', 'mtr_deleted', user('usr_owner')],
  ] as const)('denies an %s', async (_name, matterId, caller) => {
    const { pool, calls } = accessPool([
      matter,
      { ...matter, id: 'mtr_deleted', deleted: true },
    ])

    await expect(
      resolveMatterAccess(pool, caller, matterId, 'view'),
    ).resolves.toBe('denied')
    expect(calls[0]?.sql).toContain('matter.deleted_at is null')
    expect(calls[0]?.sql).toContain('matter.organisation_id = $2')
    expect(calls[0]?.parameters).toEqual([
      matterId,
      caller.organisationId,
      caller.id,
      'view',
    ])
  })

  it('uses the matter creator rather than role as ownership', async () => {
    const { pool } = accessPool([matter])

    await expect(
      resolveMatterAccess(pool, user('usr_owner', 'member'), 'mtr_1', 'edit'),
    ).resolves.toBe('edit')
    await expect(
      resolveMatterAccess(pool, user('usr_admin', 'admin'), 'mtr_1', 'view'),
    ).resolves.toBe('denied')
  })

  it('reads grants on every request so revoke takes immediate effect', async () => {
    const liveGrants = new Map<string, MatterAccessLevel>([
      ['mtr_1:usr_viewer', 'view'],
    ])
    const { pool, calls } = accessPool([matter], liveGrants)

    await expect(
      resolveMatterAccess(pool, user('usr_viewer'), 'mtr_1', 'view'),
    ).resolves.toBe('view')
    liveGrants.delete('mtr_1:usr_viewer')
    await expect(
      resolveMatterAccess(pool, user('usr_viewer'), 'mtr_1', 'view'),
    ).resolves.toBe('denied')
    expect(calls).toHaveLength(2)
  })
})

describe('requireMatterAccess', () => {
  const matters: MatterFixture[] = [
    {
      id: 'mtr_1',
      organisationId: 'org_1',
      ownerUserId: 'usr_owner',
    },
    {
      id: 'mtr_deleted',
      organisationId: 'org_1',
      ownerUserId: 'usr_owner',
      deleted: true,
    },
  ]

  it.each([
    ['unknown', 'mtr_unknown', user('usr_other')],
    ['cross-organisation', 'mtr_1', user('usr_other', 'member', 'org_2')],
    ['soft-deleted', 'mtr_deleted', user('usr_other')],
    ['denied', 'mtr_1', user('usr_other')],
    ['administrator without a grant', 'mtr_1', user('usr_admin', 'admin')],
  ] as const)(
    'returns the uniform 404 for %s access',
    async (_name, id, caller) => {
      const { pool } = accessPool(matters)
      const response = await requirementApp(pool, caller, 'view').request(
        `/matters/${id}`,
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'matter_not_found',
          message: 'Matter not found.',
          requestId: 'req_access',
        },
      })
    },
  )

  it('keeps edit as a distinct stronger requirement', async () => {
    const { pool } = accessPool(
      [matters[0]],
      new Map([['mtr_1:usr_viewer', 'view']]),
    )
    const response = await requirementApp(
      pool,
      user('usr_viewer'),
      'edit',
    ).request('/matters/mtr_1')

    expect(response.status).toBe(404)
  })
})
