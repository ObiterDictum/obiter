import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import type { MatterAccessLevel, UserRole } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { resolveMatterAccess } from '../document-access'
import { createDocumentAccessRoutes } from './document-access'

interface MatterState {
  id: string
  organisationId: string
  ownerUserId: string
  deleted?: boolean
}

interface ShareState {
  id: string
  organisationId: string
  matterId: string
  granteeUserId: string
  accessLevel: MatterAccessLevel
  createdBy: string
  createdAt: string
}

interface AuditState {
  organisationId: string
  userId: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown>
  requestId: string
}

function matterRow(matter: MatterState) {
  return {
    id: matter.id,
    organisation_id: matter.organisationId,
    name: 'Private matter',
    description: null,
    primary_jurisdiction: 'england_and_wales',
    secondary_jurisdictions: [],
    legal_domains: [],
    client_reference: '',
    status: matter.deleted ? 'deleted' : 'active',
    created_by: matter.ownerUserId,
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    deleted_at: matter.deleted ? '2026-08-10T11:00:00.000Z' : null,
    deleted_by: matter.deleted ? matter.ownerUserId : null,
  }
}

function shareRow(share: ShareState) {
  return {
    id: share.id,
    organisation_id: share.organisationId,
    matter_id: share.matterId,
    grantee_user_id: share.granteeUserId,
    access_level: share.accessLevel,
    created_by: share.createdBy,
    created_at: share.createdAt,
  }
}

class TestDatabase {
  matters = new Map<string, MatterState>()
  users = new Map<string, string>()
  shares = new Map<string, ShareState>()
  audits: AuditState[] = []
  queries: Array<{ sql: string; parameters: unknown[] }> = []
  transactionCommands: string[] = []
  failAuditAction: string | null = null
  onTransactionMatterLock: (() => void) | null = null
  private nextShare = 1

  constructor() {
    this.matters.set('mtr_1', {
      id: 'mtr_1',
      organisationId: 'org_1',
      ownerUserId: 'usr_owner',
    })
    this.matters.set('mtr_other_org', {
      id: 'mtr_other_org',
      organisationId: 'org_2',
      ownerUserId: 'usr_owner',
    })
    this.matters.set('mtr_deleted', {
      id: 'mtr_deleted',
      organisationId: 'org_1',
      ownerUserId: 'usr_owner',
      deleted: true,
    })
    this.users.set('usr_owner', 'org_1')
    this.users.set('usr_member', 'org_1')
    this.users.set('usr_editor', 'org_1')
    this.users.set('usr_admin', 'org_1')
    this.users.set('usr_outsider', 'org_2')
  }

  addShare(input: Partial<ShareState> = {}) {
    const share: ShareState = {
      id: input.id ?? `shr_${this.nextShare++}`,
      organisationId: input.organisationId ?? 'org_1',
      matterId: input.matterId ?? 'mtr_1',
      granteeUserId: input.granteeUserId ?? 'usr_member',
      accessLevel: input.accessLevel ?? 'view',
      createdBy: input.createdBy ?? 'usr_owner',
      createdAt: input.createdAt ?? '2026-08-10T12:00:00.000Z',
    }
    this.shares.set(share.id, share)
    return share
  }

  pool() {
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
        this.queries.push({ sql, parameters })
        if (sql.includes('left join matter_shares')) {
          const [matterId, organisationId, userId] = parameters as string[]
          const matter = this.activeMatter(matterId, organisationId)
          if (!matter) return { rows: [] }
          const share = [...this.shares.values()].find(
            (candidate) =>
              candidate.matterId === matterId &&
              candidate.organisationId === organisationId &&
              candidate.granteeUserId === userId,
          )
          return {
            rows: [
              {
                created_by: matter.ownerUserId,
                access_level: share?.accessLevel ?? null,
              },
            ],
          }
        }
        if (sql.includes('from matters')) {
          const [matterId, organisationId] = parameters as string[]
          const matter = this.activeMatter(matterId, organisationId)
          return { rows: matter ? [matterRow(matter)] : [] }
        }
        if (sql.includes('from matter_shares')) {
          const [organisationId, matterId] = parameters as string[]
          return {
            rows: [...this.shares.values()]
              .filter(
                (share) =>
                  share.organisationId === organisationId &&
                  share.matterId === matterId,
              )
              .map(shareRow),
          }
        }
        throw new Error(`Unexpected direct SQL: ${sql}`)
      },
      connect: async () => {
        let stagedShares = new Map(this.shares)
        let stagedAudits = [...this.audits]
        return {
          query: async (sql: string, parameters: unknown[] = []) => {
            this.queries.push({ sql, parameters })
            const command = sql.trim()
            if (
              command === 'begin' ||
              command === 'commit' ||
              command === 'rollback'
            ) {
              this.transactionCommands.push(command)
              if (command === 'commit') {
                this.shares = stagedShares
                this.audits = stagedAudits
              }
              return { rows: [] }
            }
            if (sql.includes('from matters') && sql.includes('for update')) {
              this.onTransactionMatterLock?.()
              this.onTransactionMatterLock = null
              const [matterId, organisationId] = parameters as string[]
              const matter = this.activeMatter(matterId, organisationId)
              return {
                rows: matter ? [{ created_by: matter.ownerUserId }] : [],
              }
            }
            if (sql.includes('from users') && sql.includes('for share')) {
              const [userId, organisationId] = parameters as string[]
              return {
                rows:
                  this.users.get(userId) === organisationId
                    ? [{ id: userId }]
                    : [],
              }
            }
            if (sql.includes('insert into matter_shares')) {
              const [
                organisationId,
                matterId,
                granteeUserId,
                accessLevel,
                createdBy,
              ] = parameters as string[]
              const existing = [...stagedShares.values()].find(
                (share) =>
                  share.matterId === matterId &&
                  share.granteeUserId === granteeUserId,
              )
              const share: ShareState = {
                id: existing?.id ?? `shr_${this.nextShare++}`,
                organisationId,
                matterId,
                granteeUserId,
                accessLevel: accessLevel as MatterAccessLevel,
                createdBy,
                createdAt: '2026-08-10T13:00:00.000Z',
              }
              stagedShares.set(share.id, share)
              return { rows: [shareRow(share)] }
            }
            if (sql.includes('delete from matter_shares')) {
              const [shareId, matterId, organisationId] = parameters as string[]
              const share = stagedShares.get(shareId)
              if (
                !share ||
                share.matterId !== matterId ||
                share.organisationId !== organisationId
              ) {
                return { rows: [] }
              }
              stagedShares.delete(shareId)
              return { rows: [{ grantee_user_id: share.granteeUserId }] }
            }
            if (sql.includes('insert into audit_logs')) {
              const [
                organisationId,
                userId,
                entityType,
                entityId,
                action,
                metadata,
                requestId,
              ] = parameters as string[]
              if (this.failAuditAction === action) {
                throw new Error('audit insert failed')
              }
              stagedAudits.push({
                organisationId,
                userId,
                entityType,
                entityId,
                action,
                metadata: JSON.parse(metadata) as Record<string, unknown>,
                requestId,
              })
              return { rows: [] }
            }
            throw new Error(`Unexpected transaction SQL: ${sql}`)
          },
          release: () => undefined,
        }
      },
    } as unknown as Pool
  }

  private activeMatter(id: string, organisationId: string) {
    const matter = this.matters.get(id)
    return matter && matter.organisationId === organisationId && !matter.deleted
      ? matter
      : null
  }
}

function routeApp(
  pool: Pool,
  id = 'usr_owner',
  role: UserRole = 'member',
  organisationId = 'org_1',
) {
  const app = new Hono<{ Variables: AuthzVariables }>()
  app.onError((error, c) =>
    c.json(
      { error: { code: 'storage_unavailable', message: error.message } },
      500,
    ),
  )
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_share')
    c.set('user', { id, role, organisationId })
    await next()
  })
  app.route('/', createDocumentAccessRoutes(pool))
  return app
}

function createShare(app: ReturnType<typeof routeApp>, body: unknown) {
  return app.request('/api/matters/mtr_1/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('document access share routes', () => {
  it('lists only grant contract data for the matter owner', async () => {
    const database = new TestDatabase()
    database.addShare()

    const response = await routeApp(database.pool()).request(
      '/api/matters/mtr_1/shares',
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ownerUserId: 'usr_owner',
      shares: [
        {
          id: 'shr_1',
          matterId: 'mtr_1',
          granteeUserId: 'usr_member',
          accessLevel: 'view',
          createdBy: 'usr_owner',
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    })
  })

  it.each([
    [
      'list by an administrator',
      'usr_admin',
      'admin',
      '/api/matters/mtr_1/shares',
      { method: 'GET' },
    ],
    [
      'grant by an edit grantee',
      'usr_editor',
      'member',
      '/api/matters/mtr_1/shares',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          granteeUserId: 'usr_member',
          accessLevel: 'view',
        }),
      },
    ],
    [
      'revoke by an administrator',
      'usr_admin',
      'admin',
      '/api/matters/mtr_1/shares/shr_1',
      { method: 'DELETE' },
    ],
  ] as const)(
    'forbids share management for %s',
    async (_name, id, role, path, init) => {
      const database = new TestDatabase()
      database.addShare({ granteeUserId: 'usr_editor', accessLevel: 'edit' })

      const response = await routeApp(database.pool(), id, role).request(
        path,
        init,
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'forbidden' },
      })
    },
  )

  it.each([
    ['unknown', 'mtr_unknown'],
    ['cross-organisation', 'mtr_other_org'],
    ['soft-deleted', 'mtr_deleted'],
  ] as const)(
    'returns the uniform matter 404 for %s share management',
    async (_name, id) => {
      const database = new TestDatabase()

      const response = await routeApp(database.pool()).request(
        `/api/matters/${id}/shares`,
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'matter_not_found' },
      })
    },
  )

  it('validates access levels and same-organisation membership', async () => {
    const database = new TestDatabase()
    const app = routeApp(database.pool())

    const invalidLevel = await createShare(app, {
      granteeUserId: 'usr_member',
      accessLevel: 'owner',
    })
    const outsider = await createShare(app, {
      granteeUserId: 'usr_outsider',
      accessLevel: 'view',
    })
    const owner = await createShare(app, {
      granteeUserId: 'usr_owner',
      accessLevel: 'view',
    })

    expect(invalidLevel.status).toBe(400)
    expect(outsider.status).toBe(400)
    expect(owner.status).toBe(400)
    expect(database.shares.size).toBe(0)
    expect(database.audits).toEqual([])
  })

  it('rechecks membership inside the transaction before writing a grant', async () => {
    const database = new TestDatabase()
    database.onTransactionMatterLock = () => {
      database.users.set('usr_member', 'org_2')
    }

    const response = await createShare(routeApp(database.pool()), {
      granteeUserId: 'usr_member',
      accessLevel: 'view',
    })

    expect(response.status).toBe(400)
    expect(database.shares.size).toBe(0)
    expect(database.audits).toEqual([])
    const membershipCheck = database.queries.find((query) =>
      query.sql.includes('from users'),
    )
    expect(membershipCheck?.sql).toContain('for share')
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
  })

  it('rechecks the active matter inside the transaction', async () => {
    const database = new TestDatabase()
    database.onTransactionMatterLock = () => {
      const matter = database.matters.get('mtr_1')
      if (matter) matter.deleted = true
    }

    const response = await createShare(routeApp(database.pool()), {
      granteeUserId: 'usr_member',
      accessLevel: 'view',
    })

    expect(response.status).toBe(404)
    expect(database.shares.size).toBe(0)
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
  })

  it('upserts a level change and commits each audit with its grant', async () => {
    const database = new TestDatabase()
    const app = routeApp(database.pool())

    const created = await createShare(app, {
      granteeUserId: 'usr_member',
      accessLevel: 'view',
    })
    const changed = await createShare(app, {
      granteeUserId: 'usr_member',
      accessLevel: 'edit',
    })

    expect(created.status).toBe(201)
    expect(changed.status).toBe(201)
    await expect(changed.json()).resolves.toMatchObject({
      share: { id: 'shr_1', accessLevel: 'edit' },
    })
    expect([...database.shares.values()]).toHaveLength(1)
    expect([...database.shares.values()][0]?.accessLevel).toBe('edit')
    expect(database.audits).toEqual([
      expect.objectContaining({
        entityType: 'matter_share',
        entityId: 'shr_1',
        action: 'matter.share_grant',
        metadata: {
          matterId: 'mtr_1',
          granteeUserId: 'usr_member',
          accessLevel: 'view',
        },
      }),
      expect.objectContaining({
        entityType: 'matter_share',
        entityId: 'shr_1',
        action: 'matter.share_grant',
        metadata: {
          matterId: 'mtr_1',
          granteeUserId: 'usr_member',
          accessLevel: 'edit',
        },
      }),
    ])
    expect(database.transactionCommands).toEqual([
      'begin',
      'commit',
      'begin',
      'commit',
    ])
  })

  it('revokes transactionally and denies the grantee on the next resolution', async () => {
    const database = new TestDatabase()
    const share = database.addShare()
    const pool = database.pool()
    const grantee = {
      id: 'usr_member',
      organisationId: 'org_1',
      role: 'member' as const,
    }

    await expect(
      resolveMatterAccess(pool, grantee, 'mtr_1', 'view'),
    ).resolves.toBe('view')
    const response = await routeApp(pool).request(
      `/api/matters/mtr_1/shares/${share.id}`,
      { method: 'DELETE' },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revoked: true,
      shareId: share.id,
    })
    await expect(
      resolveMatterAccess(pool, grantee, 'mtr_1', 'view'),
    ).resolves.toBe('denied')
    expect(database.audits).toEqual([
      expect.objectContaining({
        entityId: share.id,
        action: 'matter.share_revoke',
        metadata: {
          matterId: 'mtr_1',
          granteeUserId: 'usr_member',
        },
      }),
    ])
  })

  it('returns matter_share_not_found for a missing share on an active matter', async () => {
    const database = new TestDatabase()

    const response = await routeApp(database.pool()).request(
      '/api/matters/mtr_1/shares/shr_missing',
      { method: 'DELETE' },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'matter_share_not_found' },
    })
    expect(database.audits).toEqual([])
  })

  it('rolls back both the grant and audit when audit insertion fails', async () => {
    const database = new TestDatabase()
    database.failAuditAction = 'matter.share_grant'

    const response = await createShare(routeApp(database.pool()), {
      granteeUserId: 'usr_member',
      accessLevel: 'view',
    })

    expect(response.status).toBe(500)
    expect(database.shares.size).toBe(0)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
  })

  it('rolls back both the revoke and audit when audit insertion fails', async () => {
    const database = new TestDatabase()
    const share = database.addShare()
    database.failAuditAction = 'matter.share_revoke'

    const response = await routeApp(database.pool()).request(
      `/api/matters/mtr_1/shares/${share.id}`,
      { method: 'DELETE' },
    )

    expect(response.status).toBe(500)
    expect(database.shares.get(share.id)).toEqual(share)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
  })
})
