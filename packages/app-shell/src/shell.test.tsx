import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
      <RouterProvider router={router} />
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
  it('shows the full sidebar on Home and the rail plus contents inside a matter', async () => {
    renderShell('/')
    const homeNav = await screen.findByRole('navigation', { name: 'Workspace' })
    expect(homeNav.textContent).toContain('Matters')
    expect(
      screen.getByRole('link', { name: /^Matters/ }).textContent,
    ).toContain('Matters')
    expect(
      screen.queryByRole('complementary', { name: 'Matter contents' }),
    ).toBeNull()

    cleanup()
    renderShell('/matters/mtr_1')
    const railNav = await screen.findByRole('navigation', { name: 'Workspace' })
    expect(railNav.textContent).not.toContain('Matters')
    const contents = await screen.findByRole('complementary', {
      name: 'Matter contents',
    })
    expect(contents.textContent).toContain('Smith v Jones Lettings Ltd')
    expect(contents.textContent).toContain('Defence and Counterclaim.docx')
  })

  it('collapses the sidebar on Home and remembers it', async () => {
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

  it('hides the contents panel inside a section and remembers it', async () => {
    renderShell('/matters/mtr_1')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Hide contents' }),
    )
    expect(window.localStorage.getItem('obiter.contents.hidden')).toBe('true')
    expect(
      screen.queryByRole('complementary', { name: 'Matter contents' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Show contents' })).toBeTruthy()

    cleanup()
    renderShell('/matters/mtr_1')
    expect(
      await screen.findByRole('button', { name: 'Show contents' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('complementary', { name: 'Matter contents' }),
    ).toBeNull()
  })

  it('toggles the right slot with ⌘J and only lists tabs with content', async () => {
    renderShell('/matters/mtr_1')
    await screen.findByRole('button', { name: 'Hide contents' })
    fireEvent.keyDown(window, { key: 'j', metaKey: true })
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

  it('fades the panes into focus mode and returns focus on Escape', async () => {
    renderShell('/matters/mtr_1')
    const toggle = await screen.findByRole('button', { name: 'Hide contents' })
    fireEvent.keyDown(window, { key: '.', metaKey: true })

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
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hide contents' }),
    )
    expect(toggle).toBeTruthy()
  })
})
