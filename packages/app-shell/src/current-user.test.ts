import { describe, expect, it, vi } from 'vitest'
import { currentUserQueryOptions } from './current-user'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./api', () => api)

describe('currentUserQueryOptions', () => {
  it('always resolves the current user through the authenticated API', async () => {
    api.apiFetch.mockResolvedValueOnce({
      user: { id: 'usr_1', email: 'user@example.test', name: 'User', role: 'owner' },
      organisation: { id: 'org_1', name: 'Organisation', plan: 'private_beta' },
    })

    const options = currentUserQueryOptions()

    await expect(options.queryFn?.({} as never)).resolves.toMatchObject({
      user: { id: 'usr_1' },
      organisation: { id: 'org_1' },
    })
    expect(api.apiFetch).toHaveBeenCalledWith('/api/me')
  })
})
