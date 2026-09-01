import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  organisationInvitesQueryOptions,
  organisationMembersQueryOptions,
} from './organisation-membership'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: api.apiFetch }
})

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
})
