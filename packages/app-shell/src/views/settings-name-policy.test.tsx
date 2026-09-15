// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
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
import { SettingsRouteView } from './settings'

/**
 * The name-form state policy, driven through the real TanStack Query hooks and
 * a mocked `apiFetch`, so a resolved save and a refetched canonical value meet
 * the mounted form exactly as they do in the product.
 *
 * The contract under test: a save never discards newer typing, the saved
 * baseline always tracks the authoritative value, and Reset returns to the
 * latest stored value rather than the value from the first mount.
 */
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, apiFetch: api.apiFetch }
})

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>()
  return { ...actual, useAuth: () => ({ changePassword: vi.fn() }) }
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

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderSettings(me: MeResponse = ME) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['current-user'], me)
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
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  }
}

function canonicalMe(me: MeResponse, patch: Partial<MeResponse>): MeResponse {
  return { ...me, ...patch }
}

function nameField(scope: HTMLElement, label: string) {
  return within(scope).getByLabelText<HTMLInputElement>(label)
}

function saveButton(scope: HTMLElement, name: string) {
  return within(scope).getByRole('button', { name }) as HTMLButtonElement
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Account name form — in-flight save and canonical reconciliation', () => {
  it('keeps typing that arrives while the save is pending', async () => {
    const pending = deferred<{ user: MeResponse['user'] }>()
    api.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') return pending.promise
        if (path === '/api/me') return ME
        throw new Error(`Unexpected request: ${path}`)
      },
    )

    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })
    const name = nameField(account, 'Name')

    fireEvent.change(name, { target: { value: 'Imogen Hartley-Clarke' } })
    fireEvent.click(saveButton(account, 'Save changes'))
    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledWith(
        '/api/me',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    // Typing that lands after the request began must survive the resolution.
    fireEvent.change(name, { target: { value: 'Imogen Hartley-Clarke-Jones' } })
    await act(async () => {
      pending.resolve({
        user: { ...ME.user, name: 'Imogen Hartley-Clarke' },
      })
    })

    await waitFor(() => {
      expect(within(account).queryByRole('status')).not.toBeNull()
    })
    expect(name.value).toBe('Imogen Hartley-Clarke-Jones')
  })

  it('synchronizes an otherwise unchanged submitted value to the stored one', async () => {
    api.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          return { user: { ...ME.user, name: 'Imogen Hartley-Clarke' } }
        }
        if (path === '/api/me') {
          return canonicalMe(ME, {
            user: { ...ME.user, name: 'Imogen Hartley-Clarke' },
          })
        }
        throw new Error(`Unexpected request: ${path}`)
      },
    )

    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })
    const name = nameField(account, 'Name')

    // Untrimmed: the field keeps the submitted text, the server keeps trimmed.
    fireEvent.change(name, { target: { value: '  Imogen Hartley-Clarke  ' } })
    fireEvent.click(saveButton(account, 'Save changes'))

    await waitFor(() => {
      expect(name.value).toBe('Imogen Hartley-Clarke')
    })
    expect(saveButton(account, 'Save changes').disabled).toBe(true)
  })

  it('adopts an external canonical value into a clean form', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/me') return ME
      throw new Error(`Unexpected request: ${path}`)
    })

    const { queryClient } = renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })
    const name = nameField(account, 'Name')
    expect(name.value).toBe('Imogen Hartley')

    await act(async () => {
      queryClient.setQueryData(
        ['current-user'],
        canonicalMe(ME, { user: { ...ME.user, name: 'Renamed Elsewhere' } }),
      )
    })

    await waitFor(() => {
      expect(name.value).toBe('Renamed Elsewhere')
    })
    expect(saveButton(account, 'Save changes').disabled).toBe(true)
  })

  it('preserves a dirty form across an external change and resets to the latest baseline', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/me') return ME
      throw new Error(`Unexpected request: ${path}`)
    })

    const { queryClient } = renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })
    const name = nameField(account, 'Name')

    fireEvent.change(name, { target: { value: 'My Unsubmitted Draft' } })

    await act(async () => {
      queryClient.setQueryData(
        ['current-user'],
        canonicalMe(ME, { user: { ...ME.user, name: 'Renamed Elsewhere' } }),
      )
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<MeResponse>(['current-user'])?.user.name,
      ).toBe('Renamed Elsewhere')
    })
    expect(name.value).toBe('My Unsubmitted Draft')

    fireEvent.click(within(account).getByRole('button', { name: 'Reset' }))
    expect(name.value).toBe('Renamed Elsewhere')
    expect(saveButton(account, 'Save changes').disabled).toBe(true)
  })

  it('does not carry draft state across an identity switch', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/me') return ME
      throw new Error(`Unexpected request: ${path}`)
    })

    const { queryClient } = renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })
    const name = nameField(account, 'Name')
    fireEvent.change(name, { target: { value: 'Draft For The Old User' } })

    await act(async () => {
      queryClient.setQueryData(['current-user'], {
        user: {
          id: 'usr_9',
          email: 'other@obiter.dev',
          name: 'Other Owner',
          role: 'owner',
        },
        organisation: {
          id: 'org_9',
          name: 'Other Chambers',
          plan: 'private_beta',
        },
      } satisfies MeResponse)
    })

    await waitFor(() => {
      expect(name.value).toBe('Other Owner')
    })
    expect(saveButton(account, 'Save changes').disabled).toBe(true)
  })
})

describe('Organisation name form — in-flight save and canonical reconciliation', () => {
  async function openOrganisation() {
    fireEvent.click(await screen.findByRole('button', { name: 'Organisation' }))
    return screen.findByRole('region', { name: 'Organisation' })
  }

  it('keeps typing that arrives while the rename is pending', async () => {
    const pending = deferred<{ organisation: MeResponse['organisation'] }>()
    api.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') return pending.promise
        if (path === '/api/me') return ME
        throw new Error(`Unexpected request: ${path}`)
      },
    )

    renderSettings()
    const organisation = await openOrganisation()
    const name = nameField(organisation, 'Organisation name')

    fireEvent.change(name, { target: { value: 'Ashcombe Chambers LLP' } })
    fireEvent.click(saveButton(organisation, 'Save name'))
    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledWith(
        '/api/organisations',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    fireEvent.change(name, {
      target: { value: 'Ashcombe Chambers LLP (draft)' },
    })
    await act(async () => {
      pending.resolve({
        organisation: { ...ME.organisation!, name: 'Ashcombe Chambers LLP' },
      })
    })

    await waitFor(() => {
      expect(within(organisation).queryByRole('status')).not.toBeNull()
    })
    expect(name.value).toBe('Ashcombe Chambers LLP (draft)')
  })

  it('preserves a dirty form across an external change and resets to the latest baseline', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/me') return ME
      throw new Error(`Unexpected request: ${path}`)
    })

    const { queryClient } = renderSettings()
    const organisation = await openOrganisation()
    const name = nameField(organisation, 'Organisation name')
    expect(name.value).toBe('Ashcombe Chambers')

    fireEvent.change(name, { target: { value: 'My Draft Chambers' } })
    await act(async () => {
      queryClient.setQueryData(
        ['current-user'],
        canonicalMe(ME, {
          organisation: {
            ...ME.organisation!,
            name: 'Renamed By Another Owner',
          },
        }),
      )
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<MeResponse>(['current-user'])?.organisation
          ?.name,
      ).toBe('Renamed By Another Owner')
    })
    expect(name.value).toBe('My Draft Chambers')

    fireEvent.click(within(organisation).getByRole('button', { name: 'Reset' }))
    expect(name.value).toBe('Renamed By Another Owner')
    expect(saveButton(organisation, 'Save name').disabled).toBe(true)
  })

  it('keeps the draft and the previous baseline when the rename fails', async () => {
    api.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          throw new Error('network down')
        }
        if (path === '/api/me') return ME
        throw new Error(`Unexpected request: ${path}`)
      },
    )

    renderSettings()
    const organisation = await openOrganisation()
    const name = nameField(organisation, 'Organisation name')

    fireEvent.change(name, { target: { value: 'Attempted Chambers' } })
    fireEvent.click(saveButton(organisation, 'Save name'))

    await waitFor(() => {
      expect(within(organisation).queryByRole('alert')).not.toBeNull()
    })
    expect(name.value).toBe('Attempted Chambers')

    fireEvent.click(within(organisation).getByRole('button', { name: 'Reset' }))
    expect(name.value).toBe('Ashcombe Chambers')
  })
})
