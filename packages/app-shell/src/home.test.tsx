// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { HomeRouteView } from './views/home'

// Control the three data hooks independently.
const mocks = vi.hoisted(() => ({
  useMattersList: vi.fn(),
  useCurrentUser: vi.fn(),
  changelogQueryOptions: vi.fn(),
  useCreateOrganisation: vi.fn(),
}))

vi.mock('./matters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matters')>()
  return { ...actual, useMattersList: mocks.useMattersList }
})

vi.mock('./current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./current-user')>()
  return { ...actual, useCurrentUser: mocks.useCurrentUser, useCreateOrganisation: mocks.useCreateOrganisation }
})

vi.mock('./changelog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./changelog')>()
  return {
    ...actual,
    changelogQueryOptions: mocks.changelogQueryOptions,
  }
})

const ME = {
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex Obiter', role: 'owner' as const },
  organisation: { id: 'org_1', name: 'Obiter Legal', plan: 'private_beta' as const },
}

const CHANGELOG = { entries: [], source: 'github_unavailable' }

function sampleMatter(id: string) {
  return {
    id,
    organisationId: 'org_1',
    name: `Matter ${id}`,
    description: null,
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: 'REF',
    status: 'active' as const,
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function mattersLoading() {
  return { isLoading: true, isError: false, isSuccess: false, data: undefined }
}
function mattersError() {
  return { isLoading: false, isError: true, isSuccess: false, data: undefined }
}
function mattersSuccess(count: number) {
  const data = Array.from({ length: count }, (_, i) => sampleMatter(`mtr_${i}`))
  return { isLoading: false, isError: false, isSuccess: true, data }
}

function buildRouter() {
  const rootRoute = createRootRoute()
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <HomeRouteView platform="web" />,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

function renderHome() {
  const client = new QueryClient()
  const router = buildRouter()
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useCurrentUser.mockReturnValue({ data: ME })
  mocks.useCreateOrganisation.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
  mocks.changelogQueryOptions.mockReturnValue({
    queryKey: ['github-changelog'],
    queryFn: async () => CHANGELOG,
  })
})

afterEach(() => {
  cleanup()
})

describe('HomeRouteView — matters query states', () => {
  it('shows a loading skeleton while matters are pending (not the empty/create CTA)', async () => {
    mocks.useMattersList.mockReturnValue(mattersLoading())
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Loading your matters…')).toBeTruthy()
    })
    // Must not show the empty-state CTA while pending.
    expect(screen.queryByText('Create your first matter workspace.')).toBeNull()
  })

  it('shows an error surface when matters fail to load (not the empty/create CTA)', async () => {
    mocks.useMattersList.mockReturnValue(mattersError())
    renderHome()

    await waitFor(() => {
      // Error appears in both the Matters card detail and the recent-matters section.
      expect(screen.getAllByText(/could not be loaded/i).length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Create your first matter workspace.')).toBeNull()
  })

  it('shows the empty/create CTA only on a confirmed-empty successful response', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(0))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Create your first matter workspace.')).toBeTruthy()
    })
  })

  it('shows the matter count and recent matters on a successful non-empty response', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(3))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText(/3 matters in your organisation/)).toBeTruthy()
    })
    // Recent matters section lists them.
    await waitFor(() => {
      expect(screen.getByText('Matter mtr_0')).toBeTruthy()
    })
  })
})

describe('HomeRouteView — organisation-less state', () => {
  const ORGLESS_ME = {
    user: { id: 'usr_2', email: 'new@obiter.dev', name: 'New User', role: null },
    organisation: null,
  }

  it('renders the create-organisation surface for an org-less user', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    renderHome()

    // RouterProvider commits asynchronously; wait for the create-org surface.
    await waitFor(() => {
      expect(screen.getByText('Organisation name')).toBeTruthy()
    })
    expect(await screen.findByRole('button', { name: /create organisation/i })).toBeTruthy()
    // Copy explaining matters/documents live inside an organisation.
    expect(screen.getByText(/live inside an organisation/i)).toBeTruthy()
  })

  it('does not call the matters list hook for an org-less user', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useMattersList.mockReturnValue(mattersLoading())
    renderHome()

    // Wait for render to commit before asserting on hook calls.
    await waitFor(() => {
      expect(screen.getByText('Organisation name')).toBeTruthy()
    })
    // The matters hook lives in the org-present subtree; org-less users must
    // never trigger a GET /api/matters that would 403.
    expect(mocks.useMattersList).not.toHaveBeenCalled()
  })
})
