import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { RedactionRunStatus, VerificationRun } from '@obiter/contracts'
import type { MatterRecord } from './matters'
import { matterInitials } from './matters'
import type { RedactionRunListItem } from './redaction-runs'
import { buildAttentionItems } from './views/home-attention'
import {
  Sidebar,
  recentMatters,
  redactionAttentionCount,
  verificationAttentionCount,
} from './sidebar'

const mocks = vi.hoisted(() => ({
  matters: [] as MatterRecord[],
  runs: [] as Array<{ id: string; status: RedactionRunStatus }>,
  verificationRuns: [] as VerificationRun[],
}))

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMattersList: () => ({ data: mocks.matters }),
}))
const redactionModule = { ...(await import('./redaction-runs')) }
mock.module('./redaction-runs', () => ({
  ...redactionModule,
  useRedactionRunsList: () => ({ data: { runs: mocks.runs } }),
}))
const verificationModule = { ...(await import('./verification-runs')) }
mock.module('./verification-runs', () => ({
  ...verificationModule,
  useOrganisationVerificationRuns: () => ({ runs: mocks.verificationRuns }),
}))

function matter(overrides: Partial<MatterRecord> = {}): MatterRecord {
  return {
    id: 'mtr_1',
    organisationId: 'org_1',
    name: 'Northgate Foods v Brightwater Packaging',
    description: null,
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: 'NGF-0418',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function run(overrides: Partial<VerificationRun> = {}): VerificationRun {
  return {
    id: 'vrun_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-10-01T09:00:00.000Z',
    startedAt: '2026-10-01T09:00:01.000Z',
    completedAt: '2026-10-01T09:00:02.000Z',
    summary: {
      findingCount: 0,
      flaggedCount: 0,
      reviewRequiredCount: 0,
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
    matterId: 'mtr_1',
    createdAt: '2026-10-25T16:20:00.000Z',
    updatedAt: '2026-10-25T16:20:00.000Z',
    ...overrides,
  }
}

function renderSidebar(path = '/') {
  const rootRoute = createRootRoute()
  const sidebar = () => (
    <Sidebar
      orgName="Harrington Vale LLP"
      agentOpen={false}
      onToggleAgent={() => {}}
    />
  )
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: sidebar,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/matters/$matterId',
      component: sidebar,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/matters',
      component: sidebar,
    }),
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  mocks.matters = []
  mocks.runs = []
  mocks.verificationRuns = []
  window.localStorage.clear()
})

describe('sidebar data helpers', () => {
  it('counts only the redaction runs that still need a decision', () => {
    expect(
      redactionAttentionCount([
        { status: 'reviewing' },
        { status: 'pending' },
        { status: 'finalized' },
      ]),
    ).toBe(1)
    // Every span decided: the run needs finalising, not a decision.
    expect(
      redactionAttentionCount([
        {
          status: 'ready_for_review',
          summary: { totalSpans: 4, byDecision: { accept: 4, undecided: 0 } },
        },
      ]),
    ).toBe(0)
    // A failed run also waits on a person: the same rule the Redact list uses.
    expect(redactionAttentionCount([{ status: 'failed' }])).toBe(1)
  })

  // The count and the queue are two views of one rule; this fails if they drift.
  it('counts exactly the Redact runs Home queues', () => {
    const runs = [
      redactionRun({ id: 'reviewing' }),
      redactionRun({ id: 'queued', status: 'pending' }),
      redactionRun({
        id: 'decided',
        status: 'ready_for_review',
        summary: { totalSpans: 2, byDecision: { accept: 2, undecided: 0 } },
      }),
      redactionRun({ id: 'failed', status: 'failed' }),
      redactionRun({
        id: 'open',
        summary: { totalSpans: 4, byDecision: { accept: 1, undecided: 3 } },
      }),
    ]
    const queued = buildAttentionItems({
      verificationRuns: [],
      redactionRuns: runs,
      documentFilenames: new Map(),
      matters: new Map(),
    }).filter((item) => item.kind.startsWith('redact'))

    expect(queued).toHaveLength(3)
    expect(redactionAttentionCount(runs)).toBe(queued.length)
  })

  it('counts unresolved findings on completed Verify runs only', () => {
    expect(
      verificationAttentionCount([
        run({
          summary: {
            findingCount: 3,
            flaggedCount: 2,
            reviewRequiredCount: 1,
            dismissedCount: 0,
            notCheckedCount: 0,
          },
        }),
        run({ id: 'vrun_running', status: 'running' }),
        run({ id: 'vrun_clean' }),
      ]),
    ).toBe(3)
  })

  it('labels a matter tile from its client reference, else its initials', () => {
    expect(matterInitials(matter())).toBe('NGF')
    expect(matterInitials(matter({ clientReference: '' }))).toBe('NF')
  })

  it('lists the most recently updated matters, newest first', () => {
    const oldest = matter({ id: 'mtr_old', updatedAt: '2026-01-01T00:00:00Z' })
    const newest = matter({ id: 'mtr_new', updatedAt: '2026-10-01T00:00:00Z' })
    const middle = matter({ id: 'mtr_mid', updatedAt: '2026-05-01T00:00:00Z' })
    expect(recentMatters([oldest, newest, middle]).map((m) => m.id)).toEqual([
      'mtr_new',
      'mtr_mid',
      'mtr_old',
    ])
  })
})

describe('Sidebar', () => {
  it('marks the module of the current route and lists its real counts', async () => {
    mocks.matters = [matter()]
    mocks.runs = [{ id: 'run_1', status: 'reviewing' }]
    mocks.verificationRuns = [
      run({
        summary: {
          findingCount: 1,
          flaggedCount: 1,
          reviewRequiredCount: 0,
          dismissedCount: 0,
          notCheckedCount: 0,
        },
      }),
    ]
    renderSidebar('/matters')

    const matters = await screen.findByRole('link', { name: /Matters/ })
    expect(matters.getAttribute('aria-current')).toBe('page')
    expect(
      screen.getByRole('link', { name: 'Verify, 1 unresolved finding' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Redact, 1 waiting' })).toBeTruthy()
  })

  it('offers Agent as a panel toggle, second in the list, not a route', async () => {
    renderSidebar('/')
    const agent = await screen.findByRole('button', { name: 'Agent' })
    expect(agent.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: /Agent/ })).toBeNull()

    const nav = screen.getByRole('navigation', { name: 'Workspace' })
    const rows = Array.from(nav.querySelectorAll('ul:first-of-type > li')).map(
      (item) => item.querySelector('a, button')?.getAttribute('aria-label'),
    )
    expect(rows).toEqual([
      'Home',
      'Agent',
      'Search',
      'Matters',
      expect.stringMatching(/^Verify/),
      expect.stringMatching(/^Redact/),
    ])
  })

  it('collapses to the icon rail and remembers the choice', async () => {
    renderSidebar('/')
    const toggle = await screen.findByRole('button', {
      name: 'Collapse sidebar',
    })
    fireEvent.click(toggle)

    expect(window.localStorage.getItem('obiter.sidebar.collapsed')).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Expand sidebar' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
    // Every module is still reachable from the collapsed rail.
    expect(screen.getByRole('link', { name: 'Matters' })).toBeTruthy()
  })
})
