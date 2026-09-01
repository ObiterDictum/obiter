import { Hono } from 'hono'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserRole } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { createTestApiEnv } from '../test-api-env'
import { createOrganisationsRoutes } from './organisations'

interface UserRow {
  id: string
  email: string
  name: string
  role: UserRole | null
  organisationId: string | null
  emailVerified: boolean
}

interface InviteRow {
  id: string
  organisation_id: string
  email: string
  role: UserRole
  token_hash: string
  expires_at: string
  created_by: string
  created_at: string
  accepted_at: string | null
  revoked_at: string | null
}

interface MatterRow {
  organisation_id: string
}

class MembershipStore {
  users = new Map<string, UserRow>()
  organisations = new Set<string>(['org_a', 'org_b'])
  invites: InviteRow[] = []
  matters: MatterRow[] = []
  nextInvite = 1
  private snapshot: string | null = null

  constructor() {
    this.users.set('usr_owner', {
      id: 'usr_owner',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
      organisationId: 'org_a',
      emailVerified: true,
    })
    this.users.set('usr_invitee', {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      name: 'Invitee',
      role: 'owner',
      organisationId: 'org_b',
      emailVerified: true,
    })
    this.users.set('usr_other', {
      id: 'usr_other',
      email: 'other@example.com',
      name: 'Other',
      role: 'owner',
      organisationId: 'org_c',
      emailVerified: true,
    })
    this.organisations.add('org_c')
  }

  clone() {
    return JSON.stringify({
      users: [...this.users.entries()],
      organisations: [...this.organisations],
      invites: this.invites,
      matters: this.matters,
      nextInvite: this.nextInvite,
    })
  }

  restore(snapshot: string) {
    const parsed = JSON.parse(snapshot) as {
      users: [string, UserRow][]
      organisations: string[]
      invites: InviteRow[]
      matters: MatterRow[]
      nextInvite: number
    }
    this.users = new Map(parsed.users)
    this.organisations = new Set(parsed.organisations)
    this.invites = parsed.invites
    this.matters = parsed.matters
    this.nextInvite = parsed.nextInvite
  }

  query = async (sql: string, parameters: unknown[] = []) => {
    const text = sql.replace(/\s+/gu, ' ').trim()
    if (text === 'begin') {
      this.snapshot = this.clone()
      return { rows: [] }
    }
    if (text === 'commit') {
      this.snapshot = null
      return { rows: [] }
    }
    if (text === 'rollback') {
      if (this.snapshot) this.restore(this.snapshot)
      this.snapshot = null
      return { rows: [] }
    }
    if (text.includes('as occupied')) {
      const organisationId = String(parameters[0])
      const exceptUserId = String(parameters[1])
      const otherMembers = [...this.users.values()].some(
        (user) =>
          user.organisationId === organisationId && user.id !== exceptUserId,
      )
      const pendingInvites = this.invites.some(
        (invite) =>
          invite.organisation_id === organisationId &&
          !invite.accepted_at &&
          !invite.revoked_at,
      )
      const occupied =
        otherMembers ||
        this.matters.some(
          (matter) => matter.organisation_id === organisationId,
        ) ||
        pendingInvites
      return { rows: [{ occupied }] }
    }
    if (text.startsWith('insert into organisation_invites')) {
      const organisationId = String(parameters[0])
      const email = String(parameters[1])
      const open = this.invites.find(
        (invite) =>
          invite.organisation_id === organisationId &&
          invite.email === email &&
          !invite.accepted_at &&
          !invite.revoked_at,
      )
      if (open) {
        const error = new Error('duplicate') as Error & { code: string }
        error.code = '23505'
        throw error
      }
      const row: InviteRow = {
        id: `inv_${this.nextInvite}`,
        organisation_id: organisationId,
        email,
        role: parameters[2] as UserRole,
        token_hash: String(parameters[3]),
        expires_at: String(parameters[4]),
        created_by: String(parameters[5]),
        created_at: new Date().toISOString(),
        accepted_at: null,
        revoked_at: null,
      }
      this.nextInvite += 1
      this.invites.push(row)
      return { rows: [row] }
    }
    if (
      text.startsWith('select id, organisation_id, email, role, expires_at')
    ) {
      if (text.includes('where token_hash')) {
        const invite = this.invites.find(
          (row) => row.token_hash === parameters[0],
        )
        return { rows: invite ? [invite] : [] }
      }
      return {
        rows: this.invites.filter(
          (invite) =>
            invite.organisation_id === parameters[0] &&
            !invite.accepted_at &&
            !invite.revoked_at,
        ),
      }
    }
    if (
      text.startsWith('update organisation_invites') &&
      text.includes('set revoked_at')
    ) {
      const invite = this.invites.find(
        (row) =>
          row.id === parameters[0] &&
          row.organisation_id === parameters[1] &&
          !row.accepted_at &&
          !row.revoked_at,
      )
      if (!invite) return { rows: [] }
      invite.revoked_at = new Date().toISOString()
      return { rows: [{ id: invite.id }] }
    }
    if (
      text.startsWith('update organisation_invites') &&
      text.includes('set accepted_at')
    ) {
      const invite = this.invites.find(
        (row) =>
          row.id === parameters[0] && !row.accepted_at && !row.revoked_at,
      )
      if (invite) invite.accepted_at = new Date().toISOString()
      return { rows: invite ? [invite] : [] }
    }
    if (text.startsWith('delete from organisation_invites')) {
      if (text.includes('where id =')) {
        this.invites = this.invites.filter((row) => row.id !== parameters[0])
        return { rows: [] }
      }
      this.invites = this.invites.filter(
        (row) => row.organisation_id !== parameters[0],
      )
      return { rows: [] }
    }
    if (text.includes('select "organisationId"')) {
      const user = this.users.get(String(parameters[0]))
      return {
        rows: user ? [{ organisationId: user.organisationId }] : [],
      }
    }
    if (text.includes('select id, email, name, role')) {
      return {
        rows: [...this.users.values()].filter(
          (user) => user.organisationId === parameters[0] && user.role !== null,
        ),
      }
    }
    if (text.includes('select role')) {
      const user = this.users.get(String(parameters[0]))
      if (!user || user.organisationId !== parameters[1] || !user.role)
        return { rows: [] }
      return { rows: [{ role: user.role }] }
    }
    if (text.includes('select count(*)')) {
      const count = [...this.users.values()].filter(
        (user) =>
          user.organisationId === parameters[0] && user.role === 'owner',
      ).length
      return { rows: [{ count: String(count) }] }
    }
    if (
      text.startsWith('update users') &&
      text.includes('organisationId" = $1')
    ) {
      const user = this.users.get(String(parameters[2]))
      if (user) {
        user.organisationId = String(parameters[0])
        user.role = parameters[1] as UserRole
      }
      return { rows: [] }
    }
    if (
      text.startsWith('update users') &&
      text.includes('organisationId" = null')
    ) {
      const user = this.users.get(String(parameters[0]))
      if (user) {
        user.organisationId = null
        user.role = null
      }
      return { rows: [] }
    }
    if (text.startsWith('update audit_logs')) return { rows: [] }
    if (text.startsWith('delete from organisations')) {
      this.organisations.delete(String(parameters[0]))
      return { rows: [] }
    }
    return { rows: [] }
  }
}

function poolFor(store: MembershipStore) {
  return {
    query: store.query,
    connect: async () => ({ query: store.query, release: () => undefined }),
  } as unknown as Pool
}

function appFor(
  store: MembershipStore,
  user: {
    id: string
    email: string
    emailVerified: boolean
    organisationId: string | null
    role: UserRole | null
  },
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_membership')
    context.set('user', user)
    await next()
  })
  routes.route(
    '/',
    createOrganisationsRoutes(poolFor(store), createTestApiEnv()),
  )
  return routes
}

const json = (body: unknown) => ({
  method: 'POST' as const,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function tokenFromInviteLog() {
  const logged = vi
    .mocked(console.info)
    .mock.calls.find((call) =>
      String(call[0]).includes('Organisation-invite URL'),
    )
  const url = (logged?.[1] as { url?: string } | undefined)?.url
  expect(url).toBeTruthy()
  return new URL(url ?? '').searchParams.get('token') ?? ''
}

describe('organisation membership routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses invite accept twice, after revocation, and after expiry', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    const created = await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'member' }),
    )
    expect(created.status).toBe(201)
    const token = tokenFromInviteLog()
    const invitee = {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      emailVerified: true,
      organisationId: 'org_b',
      role: 'owner' as const,
    }
    const first = await appFor(store, invitee).request(
      '/api/invites/accept',
      json({ token }),
    )
    expect(first.status).toBe(200)
    const second = await appFor(store, invitee).request(
      '/api/invites/accept',
      json({ token }),
    )
    expect(second.status).toBe(404)

    vi.mocked(console.info).mockClear()
    const revokedCreate = await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'other@example.com', role: 'member' }),
    )
    expect(revokedCreate.status).toBe(201)
    const revokedToken = tokenFromInviteLog()
    const inviteId = store.invites.find(
      (invite) => invite.email === 'other@example.com',
    )?.id
    const revoked = await ownerApp.request(
      `/api/organisations/org_a/invites/${inviteId}`,
      { method: 'DELETE' },
    )
    expect(revoked.status).toBe(200)
    const afterRevoke = await appFor(store, {
      id: 'usr_other',
      email: 'other@example.com',
      emailVerified: true,
      organisationId: 'org_c',
      role: 'owner',
    }).request('/api/invites/accept', json({ token: revokedToken }))
    expect(afterRevoke.status).toBe(404)

    vi.mocked(console.info).mockClear()
    const expiredCreate = await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'other@example.com', role: 'member' }),
    )
    expect(expiredCreate.status).toBe(201)
    const expiredToken = tokenFromInviteLog()
    const expiredInvite = store.invites.find(
      (invite) => invite.email === 'other@example.com' && !invite.revoked_at,
    )
    if (expiredInvite)
      expiredInvite.expires_at = new Date(Date.now() - 1000).toISOString()
    const afterExpiry = await appFor(store, {
      id: 'usr_other',
      email: 'other@example.com',
      emailVerified: true,
      organisationId: 'org_c',
      role: 'owner',
    }).request('/api/invites/accept', json({ token: expiredToken }))
    expect(afterExpiry.status).toBe(404)
  })

  it('refuses accept when the session email does not match the invite', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'member' }),
    )
    const token = tokenFromInviteLog()
    const response = await appFor(store, {
      id: 'usr_other',
      email: 'other@example.com',
      emailVerified: true,
      organisationId: 'org_c',
      role: 'owner',
    }).request('/api/invites/accept', json({ token }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden' },
    })
  })

  it('refuses accept by an unverified user', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    store.users.get('usr_invitee')!.emailVerified = false
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'member' }),
    )
    const token = tokenFromInviteLog()
    const response = await appFor(store, {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      emailVerified: false,
      organisationId: 'org_b',
      role: 'owner',
    }).request('/api/invites/accept', json({ token }))
    expect(response.status).toBe(403)
  })

  it('refuses accept when the invitee organisation has matters', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    store.matters.push({ organisation_id: 'org_b' })
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'member' }),
    )
    const token = tokenFromInviteLog()
    const response = await appFor(store, {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      emailVerified: true,
      organisationId: 'org_b',
      role: 'owner',
    }).request('/api/invites/accept', json({ token }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'organisation_not_empty' },
    })
    expect(store.organisations.has('org_b')).toBe(true)
  })

  it('refuses accept when the invitee organisation has a pending invite', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    store.invites.push({
      id: 'inv_pending_from_b',
      organisation_id: 'org_b',
      email: 'other@example.com',
      role: 'member',
      token_hash: 'hash_pending_from_b',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: 'usr_invitee',
      created_at: new Date().toISOString(),
      accepted_at: null,
      revoked_at: null,
    })
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'member' }),
    )
    const token = tokenFromInviteLog()
    const response = await appFor(store, {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      emailVerified: true,
      organisationId: 'org_b',
      role: 'owner',
    }).request('/api/invites/accept', json({ token }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'organisation_not_empty' },
    })
    expect(store.organisations.has('org_b')).toBe(true)
    expect(store.users.get('usr_invitee')?.organisationId).toBe('org_b')
  })

  it('accepts when the invitee organisation invites are only accepted or revoked', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    store.invites.push(
      {
        id: 'inv_accepted_from_b',
        organisation_id: 'org_b',
        email: 'accepted@example.com',
        role: 'member',
        token_hash: 'hash_accepted_from_b',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: 'usr_invitee',
        created_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
        revoked_at: null,
      },
      {
        id: 'inv_revoked_from_b',
        organisation_id: 'org_b',
        email: 'revoked@example.com',
        role: 'member',
        token_hash: 'hash_revoked_from_b',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: 'usr_invitee',
        created_at: new Date().toISOString(),
        accepted_at: null,
        revoked_at: new Date().toISOString(),
      },
    )
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'member' }),
    )
    const token = tokenFromInviteLog()
    const response = await appFor(store, {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      emailVerified: true,
      organisationId: 'org_b',
      role: 'owner',
    }).request('/api/invites/accept', json({ token }))
    expect(response.status).toBe(200)
    expect(store.organisations.has('org_b')).toBe(false)
    expect(store.users.get('usr_invitee')).toMatchObject({
      organisationId: 'org_a',
      role: 'member',
    })
  })

  it('deletes the invitee empty organisation on a successful accept', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = new MembershipStore()
    const ownerApp = appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    })
    await ownerApp.request(
      '/api/organisations/org_a/invites',
      json({ email: 'invitee@example.com', role: 'admin' }),
    )
    const token = tokenFromInviteLog()
    const response = await appFor(store, {
      id: 'usr_invitee',
      email: 'invitee@example.com',
      emailVerified: true,
      organisationId: 'org_b',
      role: 'owner',
    }).request('/api/invites/accept', json({ token }))
    expect(response.status).toBe(200)
    expect(store.organisations.has('org_b')).toBe(false)
    expect(store.users.get('usr_invitee')).toMatchObject({
      organisationId: 'org_a',
      role: 'admin',
    })
    expect(store.invites.some((invite) => invite.accepted_at)).toBe(true)
  })

  it('scopes invite routes to the caller organisation', async () => {
    const store = new MembershipStore()
    const response = await appFor(store, {
      id: 'usr_owner',
      email: 'owner@example.com',
      emailVerified: true,
      organisationId: 'org_a',
      role: 'owner',
    }).request('/api/organisations/org_b/invites')
    expect(response.status).toBe(403)
  })
})
