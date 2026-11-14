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
import { buildAttentionItems, summariseAttention } from './views/home-attention'
import { Sidebar } from './sidebar'
import { SidebarRail } from './sidebar-rail'
import { recentMatters } from './sidebar-counts'
import { openWorkCount } from './open-work'

const mocks = vi.hoisted(() => ({
  matters: [] as MatterRecord[],
  runs: [] as Array<{ id: string; status: RedactionRunStatus }>,
  verificationRuns: [] as VerificationRun[],
}))

const toggleClicks: string[] = []
const collapseClicks: string[] = []

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

const accountMenuModule = { ...(await import('./account-menu')) }
mock.module('./account-menu', () => ({
  ...accountMenuModule,
  AccountMenu: () => null,
}))

const paletteOpens: HTMLElement[] = []
const commandPaletteModule = { ...(await import('./command-palette')) }
mock.module('./command-palette', () => ({
  ...commandPaletteModule,
  useCommandPalette: () => (trigger?: HTMLElement | null) => {
    if (trigger) paletteOpens.push(trigger)
  },
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

function renderSidebar(
  path = '/',
  variant: 'full' | 'rail' = 'full',
  rightSlotOpen = false,
  isStaff = false,
) {
  const rootRoute = createRootRoute()
  const sidebar = () =>
    variant === 'full' ? (
      <Sidebar
        isStaff={isStaff}
        orgName="Harrington Vale LLP"
        platform="web"
        rightSlotOpen={rightSlotOpen}
        onToggleRightSlot={() => toggleClicks.push('agent')}
        onCollapse={() => collapseClicks.push('collapse')}
      />
    ) : (
      <SidebarRail
        isStaff={isStaff}
        platform="web"
        rightSlotOpen={rightSlotOpen}
        onToggleRightSlot={() => toggleClicks.push('agent')}
        onExpand={() => collapseClicks.push('expand')}
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
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/staff',
      component: sidebar,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings',
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
  toggleClicks.length = 0
  collapseClicks.length = 0
  paletteOpens.length = 0
  window.localStorage.clear()
})

describe('sidebar data helpers', () => {
  it('counts only the redaction runs that still need a decision', () => {
    const count = (runs: RedactionRunListItem[]) =>
      openWorkCount({ verificationRuns: [], redactionRuns: runs }).redact
    expect(
      count([
        redactionRun({ id: 'reviewing' }),
        redactionRun({ id: 'queued', status: 'pending' }),
        redactionRun({ id: 'done', status: 'finalized' }),
      ]),
    ).toBe(1)
    expect(
      count([
        redactionRun({
          id: 'decided',
          status: 'ready_for_review',
          summary: { totalSpans: 4, byDecision: { accept: 4, undecided: 0 } },
        }),
      ]),
    ).toBe(0)
    expect(count([redactionRun({ id: 'failed', status: 'failed' })])).toBe(1)
  })

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
    expect(
      openWorkCount({ verificationRuns: [], redactionRuns: runs }).redact,
    ).toBe(queued.length)
  })

  it('counts exactly the finding the Home header counts', () => {
    const runs = [
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
    ]
    const items = buildAttentionItems({
      verificationRuns: runs,
      redactionRuns: [],
      documentFilenames: new Map(),
      matters: new Map(),
    })
    expect(
      openWorkCount({ verificationRuns: runs, redactionRuns: [] }).verify,
    ).toBe(3)
    expect(summariseAttention(items).total).toBe(3)
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

  it('orders the modules with Home first and toggles the agent panel from its own row', async () => {
    renderSidebar('/')
    const nav = await screen.findByRole('navigation', { name: 'Workspace' })
    const rows = Array.from(nav.querySelectorAll('ul:first-of-type > li')).map(
      (item) => item.querySelector('a, button')?.getAttribute('aria-label'),
    )
    expect(rows).toEqual([
      'Home',
      expect.stringMatching(/^Matters/),
      'Search',
      expect.stringMatching(/^Verify/),
      expect.stringMatching(/^Redact/),
      'Agent',
    ])

    const agent = screen.getByRole('button', { name: 'Agent' })
    expect(agent.textContent).toBe('Agent')
    expect(agent.classList.contains('w-full')).toBe(true)
    expect(agent.getAttribute('aria-expanded')).toBe('false')
    expect(agent.getAttribute('aria-controls')).toBe('app-shell-right-slot')
    fireEvent.click(agent)
    expect(toggleClicks).toEqual(['agent'])
  })

  it('marks the agent row as expanded while the right slot is open', async () => {
    renderSidebar('/', 'full', true)
    const agent = await screen.findByRole('button', { name: 'Agent' })
    expect(agent.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses from the toggle beside Settings rather than a title bar button', async () => {
    renderSidebar('/')
    const toggle = await screen.findByRole('button', {
      name: 'Collapse sidebar',
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const footer = toggle.parentElement
    expect(
      footer?.contains(screen.getByRole('link', { name: 'Settings' })),
    ).toBe(true)
    expect(
      footer?.contains(
        screen.getByRole('button', { name: /^Switch to (light|dark) theme$/ }),
      ),
    ).toBe(true)
    fireEvent.click(toggle)
    expect(collapseClicks).toEqual(['collapse'])
  })

  it('offers the command palette from a search field above the modules', async () => {
    renderSidebar('/')
    const field = await screen.findByRole('button', { name: 'Search Obiter' })

    expect(field.textContent).toContain('Search Obiter')
    expect(field.textContent).toContain('Ctrl+K')

    fireEvent.click(field)
    expect(paletteOpens).toEqual([field])
  })

  it('puts the search field below the organisation row so the monogram keeps the title-bar line', async () => {
    renderSidebar('/')
    const field = await screen.findByRole('button', { name: 'Search Obiter' })
    const brand = field.previousElementSibling

    expect(brand?.textContent).toContain('Obiter')
    expect(brand?.textContent).toContain('Harrington Vale LLP')
  })

  it('drops the search field to the contents divider line, clear of the brand row', async () => {
    renderSidebar('/')
    const field = await screen.findByRole('button', { name: 'Search Obiter' })
    const brand = field.previousElementSibling
    const modules = field.nextElementSibling

    expect(brand?.className).toContain('mb-7')
    expect(modules?.className).toContain('mt-1')
  })

  it('ends the footer on the workspace bottom edge', async () => {
    renderSidebar('/')
    const sidebar = await screen.findByRole('complementary', {
      name: 'Workspace',
    })
    expect(sidebar.className).toContain('pb-2')
  })

  it('puts the monogram on the title bar row rather than a padded strip below it', async () => {
    renderSidebar('/')
    const sidebar = await screen.findByRole('complementary', {
      name: 'Workspace',
    })
    expect(sidebar.className).toContain('pt-1')
    expect(sidebar.className).not.toContain('pt-10')
  })
})

describe('SidebarRail', () => {
  it('keeps every module reachable as a labelled icon', async () => {
    mocks.matters = [matter()]
    renderSidebar('/matters', 'rail')

    const home = await screen.findByRole('link', { name: 'Obiter home' })
    expect(home).toBeTruthy()
    const matters = screen.getByRole('link', { name: 'Matters, 1 active' })
    expect(matters.getAttribute('aria-current')).toBe('page')
    expect(matters.textContent).toBe('')
    expect(screen.getByRole('link', { name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Verify' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Redact' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
  })

  it('expands from the rail toggle, which stays centred with the other rail icons', async () => {
    renderSidebar('/matters', 'rail')
    const toggle = await screen.findByRole('button', { name: 'Expand sidebar' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.className).toContain('size-9')
    fireEvent.click(toggle)
    expect(collapseClicks).toEqual(['expand'])
  })

  it('puts the rail mark on the title bar row rather than a padded strip below it', async () => {
    renderSidebar('/matters', 'rail')
    const rail = await screen.findByRole('navigation', { name: 'Workspace' })
    expect(rail.className).not.toContain('pt-10')
  })

  it('keeps Agent with the modules at the top of the rail', async () => {
    renderSidebar('/matters', 'rail')
    const agent = await screen.findByRole('button', { name: 'Agent' })
    const redact = screen.getByRole('link', { name: 'Redact' })
    expect(
      redact.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      agent.compareDocumentPosition(
        screen.getByRole('link', { name: 'Settings' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('toggles the agent panel from the rail', async () => {
    renderSidebar('/matters', 'rail', true)
    const agent = await screen.findByRole('button', { name: 'Agent' })
    expect(agent.getAttribute('aria-expanded')).toBe('true')
    expect(agent.getAttribute('aria-controls')).toBe('app-shell-right-slot')
    fireEvent.click(agent)
    expect(toggleClicks).toEqual(['agent'])
  })
})

for (const variant of ['full', 'rail'] as const) {
  it(`hides Staff from non-staff in the ${variant} sidebar`, async () => {
    renderSidebar('/', variant)
    await screen.findByRole('link', { name: 'Settings' })
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull()
  })
  it(`shows Staff to staff in the ${variant} sidebar`, async () => {
    renderSidebar('/', variant, false, true)
    expect(await screen.findByRole('link', { name: 'Staff' })).toBeTruthy()
  })
  it(`marks Staff current on a staff route in the ${variant} sidebar`, async () => {
    renderSidebar('/staff', variant, false, true)
    const staff = await screen.findByRole('link', { name: 'Staff' })
    expect(staff.getAttribute('aria-current')).toBe('page')
  })
  it(`sits Staff at the bottom of the module column above Settings in the ${variant} sidebar`, async () => {
    renderSidebar('/', variant, false, true)
    const staff = await screen.findByRole('link', { name: 'Staff' })
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(
      staff.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    if (variant === 'full') {
      const nav = screen.getByRole('navigation', { name: 'Workspace' })
      expect(nav.contains(staff)).toBe(true)
      expect(staff.className).toContain('text-meta')
    }
  })
}
