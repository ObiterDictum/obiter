import '@obiter/test-dom'
import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { MeResponse } from '@obiter/contracts'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

// The real module's export names, available as undefined, so bun's
// static link check accepts imports the mock does not override.
const apiKeys = Object.fromEntries(
  Object.keys(await import('./api')).map((key) => [key, undefined]),
)
mock.module('./api', () => Object.assign({ ...apiKeys }, api))

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { currentUserQueryOptions, useCreateOrganisation } =
  await import('./current-user')

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
