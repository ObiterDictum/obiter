import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@obiter/ui'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { VerificationRun } from '@obiter/contracts'
import { documentsKeys } from './documents'
import type { MatterRecord } from './matters'
import type { RedactionRunListItem } from './redaction-runs'
import { writeRecentLegalSearch } from './legal-search-recents'
import { HomeRouteView } from './views/home'

const mocks = vi.hoisted(() => ({
  useMattersList: vi.fn(),
  useCurrentUser: vi.fn(),
  useRedactionRunsList: vi.fn(),
  useOrganisationVerificationRuns: vi.fn(),
  useVerificationRunDocuments: vi.fn(),
  useVerificationFindings: vi.fn(),
  useRecentlyOpenedDocument: vi.fn(),
}))

// Each module is snapshotted before mock.module registers: a factory that
// awaited its own specifier re-entered the in-flight mock and deadlocked under
// bun's module registry.
const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMattersList: mocks.useMattersList,
}))

const currentUserModule = { ...(await import('./current-user')) }
mock.module('./current-user', () => ({
  ...currentUserModule,
  useCurrentUser: mocks.useCurrentUser,
}))

const redactionRunsModule = { ...(await import('./redaction-runs')) }
mock.module('./redaction-runs', () => ({
  ...redactionRunsModule,
  useRedactionRunsList: mocks.useRedactionRunsList,
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useRecentlyOpenedDocument: mocks.useRecentlyOpenedDocument,
}))

const verificationRunsModule = { ...(await import('./verification-runs')) }
mock.module('./verification-runs', () => ({
  ...verificationRunsModule,
  useOrganisationVerificationRuns: mocks.useOrganisationVerificationRuns,
  useVerificationRunDocuments: mocks.useVerificationRunDocuments,
  useVerificationFindings: mocks.useVerificationFindings,
}))

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

function matter(
  id: string,
  overrides: Partial<MatterRecord> = {},
): MatterRecord {
  return {
    id,
    organisationId: 'org_1',
    name: `Matter ${id}`,
    description: null,
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: `REF-${id}`,
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-26T09:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function document(matterId: string, id: string, status = 'ready') {
  return {
    id,
    organisationId: 'org_1',
    matterId,
    currentVersionId: `ver_${id}`,
    logicalKey: `${id}.docx`,
    createdBy: 'usr_1',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-26T11:30:00.000Z',
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: `ver_${id}`,
      organisationId: 'org_1',
      matterId,
      matterDocumentId: id,
      filename: `${id}.docx`,
      fileType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: '1024',
      objectKey: 'obj',
      textObjectKey: null,
      documentStatus: status,
      failureReason: null,
      versionNumber: 2,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: '2026-10-26T11:30:00.000Z',
      updatedAt: '2026-10-26T11:30:00.000Z',
    },
  }
}

function verificationRun(
  overrides: Partial<VerificationRun> & { id: string },
): VerificationRun {
  return {
    organisationId: 'org_1',
    matterId: 'mtr_0',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-10-26T09:02:00.000Z',
    startedAt: '2026-10-26T09:02:00.000Z',
    completedAt: '2026-10-26T09:04:00.000Z',
    summary: {
      findingCount: 3,
      flaggedCount: 1,
      reviewRequiredCount: 2,
      dismissedCount: 0,
      notCheckedCount: 0,
    },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function redactionRun(
  overrides: Partial<RedactionRunListItem> & { id: string },
): RedactionRunListItem {
  return {
    sourceFilename: 'witness-statement.docx',
    status: 'reviewing',
    matterId: 'mtr_0',
    matterName: 'Matter mtr_0',
    createdAt: '2026-10-25T16:20:00.000Z',
    updatedAt: '2026-10-25T16:20:00.000Z',
    summary: {
      totalSpans: 21,
      reviewedCount: 18,
      unreviewedCount: 3,
      byDecision: { accept: 15, undecided: 3 },
    },
    ...overrides,
  }
}

function mattersState(
  state: 'loading' | 'error' | 'success',
  data?: MatterRecord[],
) {
  return {
    isPending: state === 'loading',
    isLoading: state === 'loading',
    isError: state === 'error',
    isSuccess: state === 'success',
    data,
  }
}

function runsState(runs: RedactionRunListItem[] = [], loading = false) {
  return {
    isPending: loading,
    isLoading: loading,
    isError: false,
    error: null,
    data: loading ? undefined : { runs },
  }
}

function verificationState(runs: VerificationRun[] = [], loading = false) {
  return {
    runs,
    isPending: loading,
    isError: false,
    error: null,
    hasNextPage: false,
  }
}

function buildRouter() {
  const rootRoute = createRootRoute()
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <HomeRouteView platform="web" />,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/matters',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/matters/$matterId',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/matters/$matterId/documents/$documentId',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/redact',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/redact/$runId',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/verify',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/search',
      component: () => null,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings',
      component: () => null,
    }),
  ]
  return createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

function renderHome(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={buildRouter()} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  mocks.useCurrentUser.mockReturnValue({ data: ME })
  mocks.useMattersList.mockReturnValue(
    mattersState('success', [matter('mtr_0')]),
  )
  mocks.useRedactionRunsList.mockReturnValue(runsState())
  mocks.useOrganisationVerificationRuns.mockReturnValue(verificationState())
  mocks.useVerificationRunDocuments.mockReturnValue(new Map())
  mocks.useVerificationFindings.mockReturnValue({
    findings: [],
    isPending: false,
    isError: false,
    error: null,
  })
  mocks.useRecentlyOpenedDocument.mockReturnValue({ data: null })
})

afterEach(() => {
  cleanup()
})

describe('HomeRouteView — matters states', () => {
  it('shows a loading skeleton, not the empty workspace, while matters load', async () => {
    mocks.useMattersList.mockReturnValue(mattersState('loading'))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Needs your attention')).toBeTruthy()
    })
    expect(screen.queryByText(/Set up your workspace/)).toBeNull()
  })

  it('shows the matters error where the matters rail would be', async () => {
    mocks.useMattersList.mockReturnValue(mattersState('error'))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText(/Your matters could not be loaded/)).toBeTruthy()
    })
    expect(screen.queryByText(/Set up your workspace/)).toBeNull()
  })

  it('shows the empty workspace only on a confirmed-empty response with no open work', async () => {
    mocks.useMattersList.mockReturnValue(mattersState('success', []))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Set up your workspace')).toBeTruthy()
    })
    expect(
      screen.getByRole('heading', { name: /Welcome to Obiter, Lex/ }),
    ).toBeTruthy()
    expect(screen.getByText('Create your first matter')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Search the law/ })).toBeTruthy()
  })

  it('keeps the dashboard, not the empty workspace, when open work exists', async () => {
    mocks.useMattersList.mockReturnValue(mattersState('success', []))
    mocks.useRedactionRunsList.mockReturnValue(
      runsState([redactionRun({ id: 'run_1' })]),
    )
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Needs your attention')).toBeTruthy()
    })
    expect(screen.queryByText('Set up your workspace')).toBeNull()
  })
})

describe('HomeRouteView — greeting and actions', () => {
  it('greets by first name with the absolute date and the three real actions', async () => {
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: /Good (morning|afternoon|evening), Lex/,
        }),
      ).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'New matter' })).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Upload document' })
        .getAttribute('href'),
    ).toBe('/matters')
    expect(
      screen
        .getByRole('link', { name: 'Start redaction' })
        .getAttribute('href'),
    ).toBe('/redact')
  })

  it('states only the counts that are on the queue', async () => {
    mocks.useRedactionRunsList.mockReturnValue(
      runsState([redactionRun({ id: 'run_1' })]),
    )
    mocks.useOrganisationVerificationRuns.mockReturnValue(
      verificationState([
        verificationRun({ id: 'verify_1' }),
        verificationRun({
          id: 'verify_2',
          status: 'failed',
          completedAt: '2026-10-26T14:27:00.000Z',
        }),
      ]),
    )
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByText(
          '3 items need your attention: 1 legal-accuracy risk, 1 redaction decision and 1 failed run.',
        ),
      ).toBeTruthy()
    })
  })
})

describe('HomeRouteView — needs your attention', () => {
  it('ranks a flagged finding above a redaction decision and names why each is there', async () => {
    mocks.useRedactionRunsList.mockReturnValue(
      runsState([redactionRun({ id: 'run_1' })]),
    )
    mocks.useOrganisationVerificationRuns.mockReturnValue(
      verificationState([verificationRun({ id: 'verify_1' })]),
    )
    mocks.useVerificationRunDocuments.mockReturnValue(
      new Map([
        ['doc_1', { status: 'available', filename: 'advice-note.docx' }],
      ]),
    )
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Accuracy risk')).toBeTruthy()
    })
    expect(
      screen.getByText('Awaiting a decision · 3 detected spans'),
    ).toBeTruthy()
    // The filename appears once, on the meta line; the state once, as the title.
    expect(screen.getAllByText(/advice-note\.docx/)).toHaveLength(1)
    expect(screen.queryByText('Flagged')).toBeNull()
    expect(screen.queryByText('In review')).toBeNull()

    const rows = screen.getAllByRole('listitem')
    const accuracy = rows.findIndex((row) =>
      row.textContent?.includes('Accuracy risk'),
    )
    const decision = rows.findIndex((row) =>
      row.textContent?.includes('Awaiting a decision'),
    )
    expect(accuracy).toBeGreaterThanOrEqual(0)
    expect(accuracy).toBeLessThan(decision)

    expect(
      screen.getByRole('link', { name: 'Review finding' }).getAttribute('href'),
    ).toBe('/matters/mtr_0/documents/doc_1')
    expect(
      screen
        .getByRole('link', { name: 'Continue review' })
        .getAttribute('href'),
    ).toBe('/redact/run_1')
  })

  it('explains a failed Verify run in the words Verify uses for the failure', async () => {
    mocks.useOrganisationVerificationRuns.mockReturnValue(
      verificationState([
        verificationRun({
          id: 'verify_1',
          status: 'failed',
          failureCode: 'execution_failed',
        }),
      ]),
    )
    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Verify run did not finish')).toBeTruthy()
    })
    expect(
      screen.getByText(
        'No successful result was recorded, and the document was not changed.',
      ),
    ).toBeTruthy()
  })

  it('says the queue is clear instead of inventing activity', async () => {
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByText('Nothing needs your attention right now.'),
      ).toBeTruthy()
    })
    expect(
      screen.getByText(
        /No Verify findings, redaction decisions or failed runs/,
      ),
    ).toBeTruthy()
  })
})

describe('HomeRouteView — rail', () => {
  it('lists recent documents and matters from the queries the shell already runs', async () => {
    const client = new QueryClient()
    client.setQueryData(documentsKeys.byMatter('mtr_0'), [
      document('mtr_0', 'advice-note'),
    ])
    renderHome(client)

    await waitFor(() => {
      expect(screen.getByText('Recent documents')).toBeTruthy()
    })
    expect(screen.getByText('advice-note.docx')).toBeTruthy()
    expect(screen.getByText('1 document · REF-mtr_0')).toBeTruthy()
    // One initials helper for matters, the same label the sidebar shows.
    expect(screen.getByText('REF')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /All 1/ }).getAttribute('href'),
    ).toBe('/matters')
  })
})

describe('HomeRouteView — continue where you left off', () => {
  it('names the last document opened, its matter and when', async () => {
    mocks.useRecentlyOpenedDocument.mockReturnValue({
      data: {
        documentId: 'doc_1',
        matterId: 'mtr_0',
        matterName: 'Lindqvist Estate',
        filename: 'witness-statement.docx',
        openedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    })
    renderHome()

    const line = await screen.findByText(/Continue where you left off:/)
    expect(line.textContent).toContain('2 hours ago')
    expect(line.closest('p, span')?.textContent).toContain('Lindqvist Estate')
    const link = screen.getByRole('link', { name: 'witness-statement.docx' })
    expect(link.getAttribute('href')).toBe('/matters/mtr_0/documents/doc_1')
  })

  it('shows nothing extra before a document has been opened', async () => {
    renderHome()
    await screen.findByRole('heading', {
      name: /Good (morning|afternoon|evening)/,
    })
    expect(screen.queryByText(/Continue where you left off/)).toBeNull()
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

  it('renders the dashboard without Settings-required gating on a personal workspace', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useMattersList.mockReturnValue(mattersState('loading'))
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: /Good (morning|afternoon|evening), New/,
        }),
      ).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: 'Start redaction' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /create organisation/i }),
    ).toBeNull()
    expect(screen.queryByText(/Create an organisation in Settings/i)).toBeNull()
  })

  it('enables the matters list query for an org-less user', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: ORGLESS_ME })
    mocks.useMattersList.mockReturnValue(mattersState('success', []))
    renderHome()

    await waitFor(() => {
      expect(mocks.useMattersList).toHaveBeenCalled()
    })
    expect(mocks.useMattersList).not.toHaveBeenCalledWith({ enabled: false })
  })
})

describe('HomeRouteView — default workspace naming prompt', () => {
  it('prompts the owner of a default-named workspace to name it', async () => {
    mocks.useCurrentUser.mockReturnValue({
      data: {
        ...ME,
        organisation: { ...ME.organisation, name: 'Personal workspace' },
      },
    })
    mocks.useMattersList.mockReturnValue(mattersState('success', []))
    renderHome()

    await waitFor(() => {
      expect(screen.getByText(/still has its default name/i)).toBeTruthy()
    })
    expect(
      screen
        .getByRole('link', { name: /Name it in Settings/ })
        .getAttribute('href'),
    ).toBe('/settings')
  })

  it('shows no prompt for named workspaces or non-owners', async () => {
    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Needs your attention')).toBeTruthy()
    })
    expect(screen.queryByText(/still has its default name/i)).toBeNull()
    cleanup()

    mocks.useCurrentUser.mockReturnValue({
      data: {
        user: { ...ME.user, role: 'member' as const },
        organisation: { ...ME.organisation, name: 'Personal workspace' },
      },
    })
    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Needs your attention')).toBeTruthy()
    })
    expect(screen.queryByText(/still has its default name/i)).toBeNull()
  })
})

describe('HomeRouteView — empty workspace search', () => {
  it('shows stored recent searches instead of the example suggestions', async () => {
    writeRecentLegalSearch(
      window.sessionStorage,
      'beneficial ownership of shares',
    )
    mocks.useMattersList.mockReturnValue(mattersState('success', []))
    renderHome()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /beneficial ownership of shares/ }),
      ).toBeTruthy()
    })
    expect(screen.getByLabelText('Recent searches')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Wood v Capita/ })).toBeNull()
  })
})
