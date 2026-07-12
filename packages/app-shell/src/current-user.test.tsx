// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { MeResponse } from '@obiter/contracts'
import { currentUserQueryOptions, useCreateOrganisation } from './current-user'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./api', () => api)

const ORGLESS_ME: MeResponse = {
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: null },
  organisation: null,
}

describe('currentUserQueryOptions', () => {
  it('always resolves the current user through the authenticated API', async () => {
    api.apiFetch.mockResolvedValueOnce({
      user: {
        id: 'usr_1',
        email: 'user@example.test',
        name: 'User',
        role: 'owner',
      },
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

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useCreateOrganisation', () => {
  it('updates the current-user cache immediately with the created organisation', async () => {
    const client = new QueryClient()
    client.setQueryData(['current-user'], ORGLESS_ME)
    api.apiFetch.mockResolvedValueOnce({
      organisation: { id: 'org_new', name: 'Acme Law', plan: 'private_beta' },
    })

    const { result } = renderHook(() => useCreateOrganisation(), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      const org = await result.current.mutateAsync({ name: 'Acme Law' })
      expect(org).toMatchObject({ id: 'org_new', name: 'Acme Law' })
    })

    // The cache reflects the created organisation without a refetch.
    await waitFor(() => {
      const cached = client.getQueryData<MeResponse>(['current-user'])
      expect(cached?.organisation).toMatchObject({
        id: 'org_new',
        name: 'Acme Law',
      })
      expect(cached?.user.role).toBe('owner')
    })
  })
})
