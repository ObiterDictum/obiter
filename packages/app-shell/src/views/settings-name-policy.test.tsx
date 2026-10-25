import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
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

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const apiModule = { ...(await import('../api')) }
mock.module('../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const authModule = { ...(await import('../auth')) }
mock.module('../auth', () => ({
  ...authModule,
  useAuth: () => ({ changePassword: vi.fn() }),
}))

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const organisationMembershipModuleKeys = Object.fromEntries(
  Object.keys(await import('../organisation-membership')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../organisation-membership', () =>
  Object.assign(
    { ...organisationMembershipModuleKeys },
    (() => ({
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
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { SettingsRouteView } = await import('./settings')

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
})
