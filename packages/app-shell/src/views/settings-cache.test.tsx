// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from '../api'
import { SettingsRouteView } from './settings'

/**
 * Drives the real TanStack Query hooks against a mocked `apiFetch`, so the
 * account form is exercised with the mutation that refreshes `GET /api/me`
 * rather than a stub of that mutation. `settings.test.tsx` mocks the hooks to
 * cover the UI states; this file proves the cache contract.
 */
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, apiFetch: api.apiFetch }
})

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>()
  return {
    ...actual,
    useAuth: () => ({ changePassword: vi.fn() }),
  }
})

vi.mock('../organisation-membership', () => ({
  useOrganisationMembers: () => ({ data: [] }),
  useOrganisationInvites: () => ({ data: [] }),
  useCreateOrganisationInvite: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRevokeOrganisationInvite: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRemoveOrganisationMember: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

const ME: MeResponse = {
  user: {
    id: 'usr_1',
    email: 'imogen@obiter.dev',
    name: 'Imogen Hartley',
    role: 'owner',
  },
  organisation: {
    id: 'org_1',
    name: 'Ashcombe Chambers',
    plan: 'private_beta',
  },
}

function renderSettings(client: QueryClient) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <SettingsRouteView />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function client(): QueryClient {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  instance.setQueryData(['current-user'], ME)
  return instance
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsRouteView — account save refreshes GET /api/me', () => {
  it('sends the canonical patch, refetches /api/me and shows the stored value', async () => {
    const queryClient = client()
    let storedName = ME.user.name
    api.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          storedName = 'Imogen Hartley-Clarke'
          return { user: { ...ME.user, name: storedName } }
        }
        if (path === '/api/me') {
          return { ...ME, user: { ...ME.user, name: storedName } }
        }
        throw new Error(`Unexpected request: ${path}`)
      },
    )

    renderSettings(queryClient)
    const account = await screen.findByRole('region', { name: 'Account' })

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: '  Imogen Hartley-Clarke  ' },
    })
    fireEvent.click(
      within(account).getByRole('button', { name: 'Save changes' }),
    )

    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledWith('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Imogen Hartley-Clarke' }),
      })
    })

    // The mutation refreshes the shared /api/me cache rather than leaving a
    // locally patched value behind.
    await waitFor(() => {
      expect(
        queryClient.getQueryData<MeResponse>(['current-user'])?.user.name,
      ).toBe('Imogen Hartley-Clarke')
    })
    expect(api.apiFetch).toHaveBeenCalledWith('/api/me')

    await waitFor(() => {
      expect(
        within(account).getByLabelText<HTMLInputElement>('Name').value,
      ).toBe('Imogen Hartley-Clarke')
    })
    expect(await within(account).findByRole('status')).toHaveProperty(
      'textContent',
      'Name saved.',
    )
  })

  it('keeps the typed name and reports the server failure when the patch is rejected', async () => {
    const queryClient = client()
    api.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          throw new ApiError(
            'validation_failed',
            'Name is too long.',
            400,
            'req_cache',
          )
        }
        if (path === '/api/me') return ME
        throw new Error(`Unexpected request: ${path}`)
      },
    )

    renderSettings(queryClient)
    const account = await screen.findByRole('region', { name: 'Account' })

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: 'A very long name' },
    })
    fireEvent.click(
      within(account).getByRole('button', { name: 'Save changes' }),
    )

    expect(await within(account).findByRole('alert')).toHaveProperty(
      'textContent',
      'Name is too long.',
    )
    expect(within(account).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'A very long name',
    )
    expect(
      queryClient.getQueryData<MeResponse>(['current-user'])?.user.name,
    ).toBe('Imogen Hartley')
  })
})
