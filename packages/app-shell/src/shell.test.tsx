import '@obiter/test-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
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
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import type { MeResponse } from '@obiter/contracts'
import type { MatterRecord } from './matters'
import type { MatterDocumentRecord } from './documents'

const mocks = vi.hoisted(() => ({
  matters: [] as MatterRecord[],
  documents: [] as MatterDocumentRecord[],
}))

const matter: MatterRecord = {
  id: 'mtr_1',
  organisationId: 'org_1',
  name: 'Smith v Jones Lettings Ltd',
  description: null,
  primaryJurisdiction: 'England & Wales',
  secondaryJurisdictions: [],
  legalDomains: [],
  clientReference: 'HP-2026-0412',
  status: 'active',
  createdBy: 'usr_1',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

const documentFixture: MatterDocumentRecord = {
  id: 'doc_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  currentVersionId: 'ver_1',
  logicalKey: 'defence',
  createdBy: 'usr_1',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
  currentVersion: {
    id: 'ver_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'Defence and Counterclaim.docx',
    fileType: 'docx',
    sizeBytes: '1024',
    objectKey: 'docs/doc_1/ver_1',
    textObjectKey: null,
    documentStatus: 'ready',
    failureReason: null,
    versionNumber: 1,
    contentSha256: 'sha',
    syncState: 'synced',
    createdBy: 'usr_1',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
  },
}

const me: MeResponse = {
  user: {
    id: 'usr_1',
    email: 'alex.morgan@example.com',
    name: 'Alex Morgan',
    role: 'owner',
  },
  organisation: {
    id: 'org_1',
    name: 'Harrington Vale LLP',
    plan: 'private_beta',
  },
}

const authModule = { ...(await import('./auth')) }
mock.module('./auth', () => ({
  ...authModule,
  useAuth: () => ({ session: { user: { id: 'usr_1' } }, isPending: false }),
}))

const currentUserModule = { ...(await import('./current-user')) }
mock.module('./current-user', () => ({
  ...currentUserModule,
  currentUserQueryOptions: () => ({
    queryKey: ['current-user'],
    queryFn: async () => me,
    staleTime: Infinity,
  }),
  useCurrentUser: () => ({ data: me }),
}))

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMattersList: () => ({ data: mocks.matters }),
  useMatter: () => ({ data: mocks.matters[0], isPending: false }),
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useMatterDocuments: () => ({ data: mocks.documents, isPending: false }),
  useCitationTargets: () => ({ data: [] }),
  useRecentlyOpenedDocument: () => ({ data: null }),
}))

const redactionModule = { ...(await import('./redaction-runs')) }
mock.module('./redaction-runs', () => ({
  ...redactionModule,
  useRedactionRunsList: () => ({ data: { runs: [] }, isPending: false }),
}))

const verificationModule = { ...(await import('./verification-runs')) }
mock.module('./verification-runs', () => ({
  ...verificationModule,
  useOrganisationVerificationRuns: () => ({
    runs: [],
    isPending: false,
    isError: false,
  }),
}))

const accountMenuModule = { ...(await import('./account-menu')) }
mock.module('./account-menu', () => ({
  ...accountMenuModule,
  AccountMenu: () => null,
}))

const { ShellFrame } = await import('./frame')
const { PagePanelToggle } = await import('./page-panel')

function PathProbe() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return <p data-testid="pathname">{pathname}</p>
}

function renderShell(path: string) {
  const rootRoute = createRootRoute()
  const page = () => (
    <ShellFrame platform="web">
      <PagePanelToggle />
      <PathProbe />
      <input aria-label="Note" />
    </ShellFrame>
  )
  const paths = [
    '/',
    '/matters',
    '/matters/$matterId',
    '/verify',
    '/redact',
    '/search',
    '/settings',
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      paths.map((routePath) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path: routePath,
          component: page,
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.matters = [matter]
  mocks.documents = [documentFixture]
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('shell frame', () => {
  it('keeps the full sidebar on a section route, with that section’s contents beside it', async () => {
    renderShell('/matters/mtr_1')
    const nav = await screen.findByRole('navigation', { name: 'Workspace' })
    expect(nav.textContent).toContain('Home')
    const contents = await screen.findByRole('complementary', {
      name: 'Matter contents',
    })
    expect(contents.textContent).toContain('Smith v Jones Lettings Ltd')
    expect(contents.textContent).toContain('Defence and Counterclaim.docx')
  })

  it('shows no contents panel on Home, which has no section list', async () => {
    renderShell('/')
    const nav = await screen.findByRole('navigation', { name: 'Workspace' })
    expect(nav.textContent).toContain('Home')
    expect(document.querySelector('#app-shell-contents')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Hide|Show) / })).toBeNull()
  })

  it('hides only the contents panel from the toggle beside the page title', async () => {
    renderShell('/matters/mtr_1')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Hide matter contents' }),
    )
    expect(window.localStorage.getItem('obiter.contents.hidden')).toBe('true')
    expect(
      screen.queryByRole('complementary', { name: 'Matter contents' }),
    ).toBeNull()
    expect(
      (await screen.findByRole('navigation', { name: 'Workspace' }))
        .textContent,
    ).toContain('Recent matters')
    expect(
      screen.getByRole('button', { name: 'Show matter contents' }),
    ).toBeTruthy()

    cleanup()
    renderShell('/matters/mtr_1')
    expect(
      await screen.findByRole('button', { name: 'Show matter contents' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('complementary', { name: 'Matter contents' }),
    ).toBeNull()
  })

  it('leaves no app sidebar collapse control in the breadcrumb row', async () => {
    renderShell('/matters/mtr_1')
    await screen.findByRole('navigation', { name: 'Workspace' })
    const titleBar = document.querySelector('header')
    expect(
      within(titleBar as HTMLElement).queryByRole('button', {
        name: /^(Collapse|Expand) sidebar$/,
      }),
    ).toBeNull()
    expect(
      within(titleBar as HTMLElement).queryByRole('button', {
        name: /^(Hide|Show) matter contents$/,
      }),
    ).toBeNull()
    expect(
      document
        .querySelector('#app-shell-sidebar')
        ?.contains(screen.getByRole('button', { name: 'Collapse sidebar' })),
    ).toBe(true)
  })

  it('collapses the sidebar from the toggle beside Settings and remembers it', async () => {
    renderShell('/')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Collapse sidebar' }),
    )
    expect(window.localStorage.getItem('obiter.sidebar.collapsed')).toBe('true')
    expect(
      (await screen.findByRole('navigation', { name: 'Workspace' }))
        .textContent,
    ).not.toContain('Recent matters')

    cleanup()
    renderShell('/')
    expect(
      (await screen.findByRole('navigation', { name: 'Workspace' }))
        .textContent,
    ).not.toContain('Recent matters')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })

  it('toggles the right slot with Ctrl+J and only lists tabs with content', async () => {
    renderShell('/matters/mtr_1')
    await screen.findByRole('button', { name: 'Hide matter contents' })
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    const slot = await screen.findByRole('complementary', {
      name: 'Agent panel',
    })
    expect(slot.textContent).toContain('Agent')
    expect(screen.queryByRole('tab', { name: 'Comments' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Checks' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'History' })).toBeNull()
    expect(window.localStorage.getItem('obiter.rightSlot.open')).toBe('true')

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(
      screen.queryByRole('complementary', { name: 'Agent panel' }),
    ).toBeNull()
  })

  it('toggles the right slot from the sidebar and keeps no panel button in the title bar', async () => {
    renderShell('/')
    await screen.findByRole('button', { name: 'Collapse sidebar' })
    expect(screen.queryByRole('button', { name: 'Show panel' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    await screen.findByRole('complementary', { name: 'Agent panel' })
    expect(
      screen
        .getByRole('button', { name: 'Agent' })
        .getAttribute('aria-expanded'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    expect(
      screen.queryByRole('complementary', { name: 'Agent panel' }),
    ).toBeNull()
  })

  it('opens the command palette from the sidebar field and returns focus to it on Escape', async () => {
    renderShell('/')
    const trigger = await screen.findByRole('button', { name: 'Search Obiter' })
    expect(trigger.textContent).toContain('Ctrl+K')
    fireEvent.click(trigger)

    const input = await screen.findByRole('combobox', { name: 'Search Obiter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('opens the command palette with the primary-modifier shortcut', async () => {
    renderShell('/')
    await screen.findByRole('button', { name: 'Search Obiter' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(
      await screen.findByRole('combobox', { name: 'Search Obiter' }),
    ).toBeTruthy()
  })

  it('opens a matter from the command palette', async () => {
    renderShell('/')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Search Obiter' }),
    )
    const input = await screen.findByRole('combobox', { name: 'Search Obiter' })
    fireEvent.change(input, { target: { value: 'smith' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByTestId('pathname').textContent).toBe('/matters/mtr_1'),
    )
  })

  it('puts the search field at the top of the sidebar rather than the title bar', async () => {
    renderShell('/')
    await screen.findByRole('navigation', { name: 'Workspace' })
    expect(
      document
        .querySelector('#app-shell-sidebar')
        ?.querySelector('[aria-label="Search Obiter"]'),
    ).not.toBeNull()
    expect(
      document
        .querySelector('header')
        ?.querySelector('[aria-label="Search Obiter"]'),
    ).toBeNull()
  })

  it('moves the search field to the title bar when the sidebar is a rail', async () => {
    window.localStorage.setItem('obiter.sidebar.collapsed', 'true')
    renderShell('/')
    await screen.findByRole('navigation', { name: 'Workspace' })

    expect(
      document
        .querySelector('header')
        ?.querySelector('[aria-label="Search Obiter"]'),
    ).not.toBeNull()
    expect(
      document
        .querySelector('#app-shell-sidebar')
        ?.querySelector('[aria-label="Search Obiter"]'),
    ).toBeNull()
  })

  it('runs the sidebar to the top so the title bar starts at the content pane', async () => {
    renderShell('/matters/mtr_1')
    const nav = await screen.findByRole('navigation', { name: 'Workspace' })
    const column =
      document.querySelector('#app-shell-sidebar')?.parentElement?.children[1]
    const pane = document.querySelector('#app-shell-pane')
    const titleBar = document.querySelector('header')
    expect(column?.contains(titleBar as Node)).toBe(true)
    expect(column?.contains(pane as Node)).toBe(true)
    expect(column?.contains(nav)).toBe(false)
  })

  it('makes the main pane the container the page layouts measure', async () => {
    renderShell('/matters/mtr_1')
    await screen.findByRole('button', { name: 'Hide matter contents' })
    expect(document.querySelector('main')?.className).toContain('@container')
  })

  it('does not treat the go sequence as a shortcut while typing', async () => {
    renderShell('/matters/mtr_1')
    const input = await screen.findByLabelText('Note')
    input.focus()
    fireEvent.keyDown(input, { key: 'g' })
    fireEvent.keyDown(input, { key: 'v' })
    await waitFor(() =>
      expect(screen.getByTestId('pathname').textContent).toBe('/matters/mtr_1'),
    )
  })

  it('fades the panes into focus mode and returns focus to the panel toggle on Escape', async () => {
    renderShell('/matters/mtr_1')
    await screen.findByRole('button', { name: 'Hide matter contents' })
    fireEvent.keyDown(window, { key: '.', ctrlKey: true })

    expect(
      screen.getByRole('button', { name: 'Leave focus mode' }),
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull()
    expect(
      screen.queryByRole('complementary', { name: 'Matter contents' }),
    ).toBeNull()
    expect(screen.getByTestId('pathname')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      await screen.findByRole('navigation', { name: 'Workspace' }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Hide matter contents' }),
      ),
    )
  })
})

describe('shell layout modes', () => {
  it('keeps the sidebar chrome when the stored layout is not a layout', async () => {
    window.localStorage.setItem('obiter.layout', 'grid')
    renderShell('/')
    expect(
      await screen.findByRole('navigation', { name: 'Workspace' }),
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull()
  })

  it('keeps the sidebar chrome when storage cannot be read', async () => {
    const reads = spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    try {
      renderShell('/')
      expect(
        await screen.findByRole('navigation', { name: 'Workspace' }),
      ).toBeTruthy()
    } finally {
      reads.mockRestore()
    }
  })

  it('replaces the sidebar and breadcrumb with module tabs in tabs layout', async () => {
    window.localStorage.setItem('obiter.layout', 'tabs')
    renderShell('/')

    expect(
      await screen.findByRole('navigation', { name: 'Modules' }),
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current'),
    ).toBe('page')
    for (const name of ['Matters', 'Search', 'Verify', 'Redact']) {
      expect(
        screen.getByRole('link', { name: new RegExp(`^${name}`) }),
      ).toBeTruthy()
    }

    const header = document.querySelector('header') as HTMLElement
    expect(
      within(header).getByRole('button', { name: 'Search Obiter' }),
    ).toBeTruthy()
    expect(within(header).getByRole('link', { name: 'Settings' })).toBeTruthy()
    expect(
      within(header).getByRole('button', {
        name: /^Switch to (light|dark) theme$/,
      }),
    ).toBeTruthy()
  })

  it('toggles the right slot from the Agent control in tabs layout', async () => {
    window.localStorage.setItem('obiter.layout', 'tabs')
    renderShell('/')
    const agent = await screen.findByRole('button', { name: 'Agent' })
    fireEvent.click(agent)
    expect(
      await screen.findByRole('complementary', { name: 'Agent panel' }),
    ).toBeTruthy()
  })

  it('moves the matter switcher beside the Matters tab inside a matter', async () => {
    window.localStorage.setItem('obiter.layout', 'tabs')
    renderShell('/matters/mtr_1')
    expect(
      await screen.findByRole('button', {
        name: /Switch matter, current matter/,
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(
      await screen.findByRole('complementary', { name: 'Matter contents' }),
    ).toBeTruthy()
  })

  it('opens the Obiter menu from the mark in clean layout and Escape returns focus', async () => {
    window.localStorage.setItem('obiter.layout', 'clean')
    renderShell('/')

    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull()
    expect(
      await screen.findByRole('navigation', { name: 'Breadcrumb' }),
    ).toBeTruthy()

    const mark = await screen.findByRole('button', { name: 'Open Obiter menu' })
    fireEvent.click(mark)

    const dialog = await screen.findByRole('dialog', { name: 'Obiter' })
    expect(within(dialog).getByRole('link', { name: /^Matters/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Agent' })).toBeTruthy()
    expect(
      within(dialog).getByRole('link', {
        name: /Smith v Jones Lettings Ltd/,
      }),
    ).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Settings' })).toBeTruthy()
    expect(within(dialog).getByText('Alex Morgan')).toBeTruthy()
    expect(
      within(dialog).getByRole('button', { name: 'Sign out' }),
    ).toBeTruthy()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Obiter' })).toBeNull(),
    )
    await waitFor(() => expect(document.activeElement).toBe(mark))
  })

  it('keeps the go shortcuts working in clean layout', async () => {
    window.localStorage.setItem('obiter.layout', 'clean')
    renderShell('/')
    await screen.findByRole('button', { name: 'Open Obiter menu' })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'm' })
    await waitFor(() =>
      expect(screen.getByTestId('pathname').textContent).toBe('/matters'),
    )
  })
})
