// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import {
  provisionPendingOrganisation,
  readPendingOrganisationName,
  savePendingOrganisationName,
} from './pending-organisation'

const apiMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: apiMocks.apiFetch }
})

function conflict() {
  return new ApiError(
    'conflict_detected',
    'You already have an organisation.',
    409,
    'req_1',
  )
}

describe('provisionPendingOrganisation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('returns false without a network call when nothing is pending', async () => {
    expect(await provisionPendingOrganisation()).toBe(false)
    expect(apiMocks.apiFetch).not.toHaveBeenCalled()
  })

  it('creates the organisation with the stashed name while org-less', async () => {
    savePendingOrganisationName('Acme Law')
    apiMocks.apiFetch.mockResolvedValueOnce({ organisation: { id: 'org_1' } })

    expect(await provisionPendingOrganisation()).toBe(true)
    expect(apiMocks.apiFetch).toHaveBeenCalledWith('/api/organisations', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme Law' }),
    })
    expect(readPendingOrganisationName()).toBeNull()
  })

  it('renames a fresh default workspace when creation 409s after auto-provision', async () => {
    savePendingOrganisationName('Acme Law')
    apiMocks.apiFetch.mockRejectedValueOnce(conflict())
    apiMocks.apiFetch.mockResolvedValueOnce({
      user: { id: 'usr_1', role: 'owner' },
      organisation: { id: 'org_1', name: 'Personal workspace' },
    })
    apiMocks.apiFetch.mockResolvedValueOnce({
      organisation: { id: 'org_1', name: 'Acme Law' },
    })

    expect(await provisionPendingOrganisation()).toBe(true)
    expect(apiMocks.apiFetch).toHaveBeenCalledWith('/api/organisations/org_1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Acme Law' }),
    })
    expect(readPendingOrganisationName()).toBeNull()
  })

  it('leaves a deliberately-named organisation alone on conflict', async () => {
    savePendingOrganisationName('Acme Law')
    apiMocks.apiFetch.mockRejectedValueOnce(conflict())
    apiMocks.apiFetch.mockResolvedValueOnce({
      user: { id: 'usr_1', role: 'owner' },
      organisation: { id: 'org_1', name: 'Real Chambers' },
    })

    expect(await provisionPendingOrganisation()).toBe(false)
    expect(apiMocks.apiFetch).toHaveBeenCalledTimes(2)
    expect(readPendingOrganisationName()).toBeNull()
  })

  it('keeps the pending name for retry when creation fails transiently', async () => {
    savePendingOrganisationName('Acme Law')
    apiMocks.apiFetch.mockRejectedValueOnce(new Error('Network down'))

    expect(await provisionPendingOrganisation()).toBe(false)
    expect(readPendingOrganisationName()).toBe('Acme Law')
  })
})
