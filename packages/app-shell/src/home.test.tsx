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
import { documentsKeys } from './documents'
import { writeWorkspaceLastPlace } from './workspace-continuity'
import { writeRecentLegalSearch } from './views/LegalSearchView'
import { HomeRouteView } from './views/home'

// Control the data hooks independently.
const mocks = vi.hoisted(() => ({
  useMattersList: vi.fn(),
  useCurrentUser: vi.fn(),
  useRedactionRunsList: vi.fn(),
  changelogQueryOptions: vi.fn(),
}))

vi.mock('./matters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matters')>()
  return { ...actual, useMattersList: mocks.useMattersList }
})

vi.mock('./current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./current-user')>()
  return {
    ...actual,
    useCurrentUser: mocks.useCurrentUser,
  }
})

vi.mock('./redaction-runs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./redaction-runs')>()
  return {
    ...actual,
    useRedactionRunsList: mocks.useRedactionRunsList,
  }
})

vi.mock('./changelog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./changelog')>()
  return {
    ...actual,
    changelogQueryOptions: mocks.changelogQueryOptions,
  }
})

const ME = {
  user: {
    id: 'usr_1',
    email: 'lex@obiter.dev',
    name: 'Lex Obiter',
    role: 'owner' as const,
  },
  organisation: {
    id: 'org_1',
    name: 'Obiter Legal',
    plan: 'private_beta' as const,
  },
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
    deletedBy: null,
  }
}

function sampleDocument(matterId: string, status: string) {
  return {
    id: `doc_${matterId}_${status}`,
    organisationId: 'org_1',
    matterId,
    currentVersionId: 'ver_1',
    logicalKey: 'brief.pdf',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: 'ver_1',
      organisationId: 'org_1',
      matterId,
      matterDocumentId: `doc_${matterId}_${status}`,
      filename: `brief-${status}.pdf`,
      fileType: 'application/pdf',
      sizeBytes: '1024',
      objectKey: 'obj',
      textObjectKey: null,
      documentStatus: status,
      failureReason: null,
      versionNumber: 1,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
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

function runsIdle() {
  return {
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { runs: [] },
  }
}

function runsWithActivity() {
  return {
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: {
      runs: [
        {
          id: 'run_1',
          organisationId: 'org_1',
          matterId: 'mtr_0',
          matterDocumentId: null,
          matterDocumentVersionId: null,
          sourceFilename: 'witness.pdf',
          sourceContentType: 'application/pdf',
          sourceByteSize: 100,
          status: 'ready_for_review',
          detectionMode: 'rules',
          errorCode: null,
          errorMessage: null,
          createdBy: 'usr_1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          summary: {
            totalSpans: 12,
            reviewedCount: 4,
            unreviewedCount: 3,
            byDecision: {
              accept: 4,
              override_redact: 1,
              undecided: 3,
            },
          },
        },
      ],
    },
  }
}

function buildRouter() {
  const rootRoute = createRootRoute()
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <HomeRouteView platform="web" />,
  })
  const mattersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/matters',
    component: () => null,
  })
  const matterDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/matters/$matterId',
    component: () => null,
  })
  const documentDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/matters/$matterId/documents/$documentId',
    component: () => null,
  })
  const redactRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/redact',
    component: () => null,
  })
  const redactRunRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/redact/$runId',
    component: () => null,
  })
  const verifyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/verify',
    component: () => null,
  })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/search',
    component: () => null,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([
      homeRoute,
      mattersRoute,
      matterDetailRoute,
      documentDetailRoute,
      redactRoute,
      redactRunRoute,
      verifyRoute,
      searchRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

function renderHome(client = new QueryClient()) {
  const router = buildRouter()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  mocks.useCurrentUser.mockReturnValue({ data: ME })
  mocks.useRedactionRunsList.mockReturnValue(runsIdle())
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
      expect(screen.getByText('Loading…')).toBeTruthy()
    })
    // Must not show the empty-state CTA while pending.
    expect(screen.queryByText(/Create your first matter/i)).toBeNull()
  })

  it('shows an error surface when matters fail to load (not the empty/create CTA)', async () => {
    mocks.useMattersList.mockReturnValue(mattersError())
    renderHome()

    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    })
    expect(screen.queryByText(/Create your first matter/i)).toBeNull()
  })

  it('shows the empty/create CTA only on a confirmed-empty successful response', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(0))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText(/Create your first matter/i)).toBeTruthy()
    })
  })

  it('shows the matter count and recent matters on a successful non-empty response', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(3))
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Active matters' }),
      ).toBeTruthy()
      expect(screen.getByText('Matter mtr_0')).toBeTruthy()
    })
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
  })
})

describe('HomeRouteView — organisation-less state', () => {
  const ORGLESS_ME = {
    user: {
      id: 'usr_2',
      email: 'new@obiter.dev',
      name: 'New User',
      role: null,
    },
    organisation: null,
  }

  it('renders the home desk without Settings-required gating for Matters/Redact', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useMattersList.mockReturnValue(mattersLoading())
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByText(/Good (morning|afternoon|evening), New/i),
      ).toBeTruthy()
    })
    expect(screen.getByText('No organisation yet')).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.getByText('Start redaction')).toBeTruthy()
    expect(screen.getByText('Your work')).toBeTruthy()
    // Quiet queue: no hollow Redaction column.
    expect(screen.queryByRole('region', { name: 'Redaction' })).toBeNull()
    expect(screen.queryByText(/Queue clear/i)).toBeNull()
    expect(screen.queryByText(/Create an organisation in Settings/i)).toBeNull()
    expect(
      screen.queryByRole('button', { name: /create organisation/i }),
    ).toBeNull()
  })

  it('enables the matters list query for an org-less user', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useMattersList.mockReturnValue(mattersLoading())
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByText(/Good (morning|afternoon|evening), New/i),
      ).toBeTruthy()
    })
    expect(mocks.useMattersList).toHaveBeenCalled()
    expect(mocks.useMattersList).not.toHaveBeenCalledWith({ enabled: false })
  })

  it('invalidates current-user once after matters succeed while org is still null', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useMattersList.mockReturnValue(mattersSuccess(0))
    const client = new QueryClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const router = buildRouter()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['current-user'] })
    })
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })
})

describe('HomeRouteView — relevant density', () => {
  it('does not render changelog tips or shortcuts in the desk body', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(1))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Matter mtr_0')).toBeTruthy()
    })
    expect(screen.queryByText('Latest updates')).toBeNull()
    expect(screen.queryByText('Try searching')).toBeNull()
    expect(screen.queryByText('Shortcuts')).toBeNull()
    expect(screen.queryByText(/No recent queries yet/i)).toBeNull()
  })

  it('shows a full-width resume strip from last place', async () => {
    writeWorkspaceLastPlace(window.sessionStorage, {
      path: '/matters/mtr_0',
      label: 'Matter',
      kind: 'matter',
      detail: 'mtr_0',
    })
    mocks.useMattersList.mockReturnValue(mattersSuccess(1))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Continue')).toBeTruthy()
    })
    const resume = screen.getByText('Continue').closest('a')
    expect(resume?.getAttribute('href')).toContain('/matters/mtr_0')
    expect(resume?.textContent).toMatch(/Matter mtr_0/)
  })

  it('shows recent search chips under the search field', async () => {
    writeRecentLegalSearch(
      window.sessionStorage,
      'beneficial ownership of shares',
    )
    mocks.useMattersList.mockReturnValue(mattersSuccess(0))
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /beneficial ownership of shares/i,
        }),
      ).toBeTruthy()
    })
    expect(screen.getByLabelText('Recent searches')).toBeTruthy()
  })

  it('hides the Redaction column when there are no runs', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(1))
    mocks.useRedactionRunsList.mockReturnValue(runsIdle())
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Matter mtr_0')).toBeTruthy()
    })
    expect(screen.queryByRole('region', { name: 'Redaction' })).toBeNull()
  })

  it('shows the Redaction column when runs exist', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(1))
    mocks.useRedactionRunsList.mockReturnValue(runsWithActivity())
    renderHome()

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Redaction' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Needs you' })).toBeTruthy()
    })
    expect(screen.getAllByText('witness.pdf').length).toBeGreaterThan(0)
  })

  it('lists documents in play from matter document attention statuses', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(1))
    const client = new QueryClient()
    client.setQueryData(documentsKeys.byMatter('mtr_0'), [
      sampleDocument('mtr_0', 'needs_review'),
      sampleDocument('mtr_0', 'ready'),
    ])
    renderHome(client)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Documents in play' }),
      ).toBeTruthy()
      expect(screen.getByText('brief-needs_review.pdf')).toBeTruthy()
    })
    expect(screen.queryByText('brief-ready.pdf')).toBeNull()
  })

  it('shows workspace usage totals below the work desk', async () => {
    mocks.useMattersList.mockReturnValue(mattersSuccess(2))
    mocks.useRedactionRunsList.mockReturnValue(runsWithActivity())
    const client = new QueryClient()
    client.setQueryData(documentsKeys.byMatter('mtr_0'), [
      sampleDocument('mtr_0', 'needs_review'),
    ])
    client.setQueryData(documentsKeys.byMatter('mtr_1'), [])
    renderHome(client)

    await waitFor(() => {
      expect(screen.getByLabelText('Workspace usage')).toBeTruthy()
    })
    const usage = screen.getByLabelText('Workspace usage')
    expect(usage.textContent).toMatch(/Matters/)
    expect(usage.textContent).toMatch(/Documents/)
    expect(usage.textContent).toMatch(/Redaction runs/)
    expect(usage.textContent).toMatch(/Finalized/)
    expect(usage.textContent).toMatch(/Spans detected/)
    expect(usage.textContent).toMatch(/Accepted to redact/)
    expect(usage.textContent).toMatch(/Unreviewed spans/)
    expect(usage.textContent).toMatch(/12/)
    expect(usage.textContent).toMatch(/5/)
    expect(usage.textContent).not.toMatch(/Searches/)
    expect(usage.textContent).not.toMatch(/token/i)
  })
})
