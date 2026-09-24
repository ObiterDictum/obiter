import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { QueryClient } from '@tanstack/react-query'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const apiModule = { ...(await import('./api')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const apiModuleKeys = Object.fromEntries(
  Object.keys(await import('./api')).map((key) => [key, undefined]),
)
mock.module('./api', () =>
  Object.assign(
    { ...apiModuleKeys },
    (() => {
      const actual = apiModule
      return { ...actual, apiFetch: api.apiFetch }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const {
  organisationInvitesQueryOptions,
  organisationMembersQueryOptions,
  invitePreviewQueryOptions,
} = await import('./organisation-membership')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('organisation membership queries', () => {
  it('lists members through GET /api/organisations/:id/members', async () => {
    api.apiFetch.mockResolvedValueOnce({
      members: [
        {
          id: 'usr_1',
          email: 'owner@obiter.dev',
          name: 'Owner',
          role: 'owner',
        },
      ],
    })
    const client = new QueryClient()
    await client.fetchQuery(organisationMembersQueryOptions('org_1'))
    expect(api.apiFetch).toHaveBeenCalledWith(
      '/api/organisations/org_1/members',
    )
  })

  it('lists invites through GET /api/organisations/:id/invites', async () => {
    api.apiFetch.mockResolvedValueOnce({ invites: [] })
    const client = new QueryClient()
    await client.fetchQuery(organisationInvitesQueryOptions('org_1'))
    expect(api.apiFetch).toHaveBeenCalledWith(
      '/api/organisations/org_1/invites',
    )
  })

  it('loads an invite preview through GET /api/invites/preview', async () => {
    api.apiFetch.mockResolvedValueOnce({
      organisationName: 'North Chambers',
      invitedByName: 'Ada Owner',
    })
    const client = new QueryClient()
    await expect(
      client.fetchQuery(invitePreviewQueryOptions('invite-token')),
    ).resolves.toEqual({
      ok: true,
      organisationName: 'North Chambers',
      invitedByName: 'Ada Owner',
    })
    expect(api.apiFetch).toHaveBeenCalledWith(
      '/api/invites/preview?token=invite-token',
    )
  })
})
