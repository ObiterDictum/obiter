// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ApiError } from '../api'
import { SettingsRouteView } from './settings'

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useCreateOrganisation: vi.fn(),
  navigate: vi.fn(),
}))

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

vi.mock('../current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../current-user')>()
  return {
    ...actual,
    useCurrentUser: mocks.useCurrentUser,
    useCreateOrganisation: mocks.useCreateOrganisation,
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

const ORGLESS_ME = {
  user: {
    id: 'usr_2',
    email: 'new@obiter.dev',
    name: 'New User',
    role: null,
  },
  organisation: null,
}

function renderSettings() {
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
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('SettingsRouteView — create organisation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useCreateOrganisation.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  async function submitWithName(name: string) {
    const input = await screen.findByLabelText('Organisation name')
    fireEvent.change(input, { target: { value: name } })
    fireEvent.submit(input.closest('form')!)
  }

  it('renders the organisation create form for an org-less user', async () => {
    renderSettings()
    expect(await screen.findByLabelText('Organisation name')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /create organisation/i }),
    ).toBeTruthy()
  })

  it('surfaces a generic error when the API rejects with a non-conflict ApiError', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError('validation_failed', 'Name is too long.', 400, 'req_1'),
      )
    mocks.useCreateOrganisation.mockReturnValue({
      mutateAsync,
      isPending: false,
    })
    renderSettings()
    await submitWithName('Acme Law')
    await waitFor(() => {
      expect(
        screen.getByText('Could not create the organisation. Try again.'),
      ).toBeTruthy()
    })
  })

  it('surfaces the conflict message and refetches /api/me on a 409', async () => {
    const refetchSpy = vi
      .spyOn(QueryClient.prototype, 'refetchQueries')
      .mockResolvedValue({
        refetchPage: undefined as never,
        errors: [],
      } as never)
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'conflict_detected',
          'You already have an organisation.',
          409,
          'req_2',
        ),
      )
    mocks.useCreateOrganisation.mockReturnValue({
      mutateAsync,
      isPending: false,
    })
    renderSettings()
    await submitWithName('Acme Law')
    await waitFor(() => {
      expect(
        screen.getByText('You already have an organisation. Refreshing…'),
      ).toBeTruthy()
    })
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['current-user'] })
    refetchSpy.mockRestore()
  })
})

describe('SettingsRouteView — members and invites', () => {
  afterEach(() => {
    cleanup()
  })

  it('hides invite and remove controls for a member-role user', async () => {
    mocks.useCurrentUser.mockReturnValue({
      data: {
        user: {
          id: 'usr_3',
          email: 'member@obiter.dev',
          name: 'Member',
          role: 'member',
        },
        organisation: {
          id: 'org_1',
          name: 'Acme Law',
          plan: 'private_beta',
        },
      },
    })
    mocks.useCreateOrganisation.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    renderSettings()
    expect(await screen.findByText('Acme Law')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /send invite/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull()
  })
})
