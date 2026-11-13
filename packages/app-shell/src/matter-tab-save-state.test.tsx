import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
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
import { ToastProvider } from '@obiter/ui'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'
import type { DocumentPresence } from '@obiter/contracts'
import type { MatterDocumentRecord } from './documents'
import type { SaveState } from './components/document-workspace/use-document-save'
import { usePublishDocumentTabStatus } from './document-tab-status'

const mocks = vi.hoisted(() => ({
  documents: [] as MatterDocumentRecord[],
  deleteAsync: vi.fn(),
  canManage: true,
}))

const matter = {
  id: 'mtr_1',
  organisationId: 'org_1',
  name: 'Smith v Jones Lettings Ltd',
  description: null,
  primaryJurisdiction: 'England & Wales',
  secondaryJurisdictions: [],
  legalDomains: [],
  clientReference: 'HP-2026-0412',
  status: 'active' as const,
  createdBy: 'usr_1',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

function documentFixture(id: string, filename: string): MatterDocumentRecord {
  return {
    id,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    currentVersionId: `ver_${id}`,
    logicalKey: id,
    createdBy: 'usr_1',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: `ver_${id}`,
      organisationId: 'org_1',
      matterId: 'mtr_1',
      matterDocumentId: id,
      filename,
      fileType: 'docx',
      sizeBytes: '1024',
      objectKey: `docs/${id}`,
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
}

const currentUserModule = { ...(await import('./current-user')) }
mock.module('./current-user', () => ({
  ...currentUserModule,
  useCurrentUser: () => ({
    data: {
      user: {
        id: 'usr_1',
        name: 'Lex',
        email: 'lex@obiter.dev',
        role: 'owner',
      },
      organisation: { id: 'org_1', name: 'Chambers', plan: 'private_beta' },
    },
  }),
}))

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMatter: () => ({ data: matter, isPending: false }),
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useMatterDocuments: () => ({ data: mocks.documents, isPending: false }),
  useDocument: () => ({ isPending: true }),
  useDeleteDocument: () => ({
    mutateAsync: mocks.deleteAsync,
    isPending: false,
  }),
}))

const redactionModule = { ...(await import('./redaction-runs')) }
mock.module('./redaction-runs', () => ({
  ...redactionModule,
  useRedactionRunsList: () => ({ data: { runs: [] }, isPending: false }),
  useCreateMatterRedactionRun: () => ({
    mutateAsync: async () => ({ run: { id: 'red_1' } }),
  }),
}))

const verificationModule = { ...(await import('./verification-runs')) }
mock.module('./verification-runs', () => ({
  ...verificationModule,
  useOrganisationVerificationRuns: () => ({
    runs: [],
    isPending: false,
    isError: false,
  }),
  useCreateVerificationRun: () => ({ isPending: false, mutate: vi.fn() }),
}))

const { MatterTabsPane, MatterWorkspace } = await import('./matter-split')
const { MatterTabStrip } = await import('./matter-tab-strip')

const PRESENCE: DocumentPresence[] = [
  { userId: 'usr_2', clientId: 'usr_2-client', cursor: null },
]

let saveStatus: SaveState['status'] = 'saved'
let participants: DocumentPresence[] = []
let tracking = false

function TabStatusHost({ documentId }: { documentId: string }) {
  usePublishDocumentTabStatus({
    documentId,
    status: saveStatus,
    versionLabel: 'version 1',
    offline: false,
    remoteChange: false,
    trackChanges: tracking,
    participants,
    presenceNames: new Map([['usr_2', 'Priya Raman']]),
    currentUserId: 'usr_1',
  })
  return null
}

function noDrag() {}

function Pane({ compact }: { compact: boolean }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const documentId = /\/documents\/([^/?#]+)/.exec(pathname)?.[1] ?? null
  return (
    <MatterWorkspace matterId="mtr_1" userId="usr_1">
      <MatterTabStrip platform="web" compact={compact} onTabDrag={noDrag} />
      <MatterTabsPane>
        <p data-testid="page">{pathname}</p>
        {documentId ? <TabStatusHost documentId={documentId} /> : null}
      </MatterTabsPane>
    </MatterWorkspace>
  )
}

function renderPane(path: string, compact = false) {
  const rootRoute = createRootRoute()
  const component = () => <Pane compact={compact} />
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      [
        '/matters/$matterId',
        '/matters/$matterId/documents/$documentId',
        '/matters/$matterId/verify',
        '/matters/$matterId/redact/$runId',
      ].map((routePath) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path: routePath,
          component,
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

function tabButton() {
  return screen.getByRole('button', { current: 'page' })
}

function saveIndicator() {
  return document.querySelector('[data-save-state]')
}

beforeEach(() => {
  mocks.documents = [
    documentFixture('doc_1', 'Defence.docx'),
    documentFixture('doc_2', 'Witness.docx'),
  ]
  mocks.deleteAsync = vi.fn()
  mocks.canManage = true
  saveStatus = 'saved'
  participants = []
  tracking = false
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('save state on the document tab', () => {
  it('marks unsaved work with a dot and names the state on the tab', async () => {
    saveStatus = 'unsaved'
    renderPane('/matters/mtr_1/documents/doc_1')

    await waitFor(() =>
      expect(tabButton().getAttribute('aria-label')).toBe(
        'Defence.docx, Unsaved changes',
      ),
    )
    expect(saveIndicator()?.getAttribute('data-save-state')).toBe('unsaved')
    expect(
      saveIndicator()?.querySelector('[data-save-indicator="dot"]'),
    ).toBeTruthy()
  })

  it('leaves a saved tab named only by its title and showing nothing', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')

    await waitFor(() =>
      expect(saveIndicator()?.getAttribute('data-save-state')).toBe('saved'),
    )
    expect(tabButton().getAttribute('aria-label')).toBe('Defence.docx')
    expect(saveIndicator()?.querySelector('[data-save-indicator]')).toBeNull()
    expect(tabButton().textContent).toBe('Defence.docx')
  })

  it('pulses the dot while a save is in flight', async () => {
    saveStatus = 'saving'
    renderPane('/matters/mtr_1/documents/doc_1')

    await waitFor(() =>
      expect(
        saveIndicator()?.querySelector('[data-save-indicator="saving"]')
          ?.className,
      ).toContain('animate-pulse'),
    )
    expect(tabButton().getAttribute('aria-label')).toBe('Defence.docx, Saving…')
  })

  it('shows a danger icon for a failed save and for work the server never saw', async () => {
    saveStatus = 'failed'
    renderPane('/matters/mtr_1/documents/doc_1')

    await waitFor(() =>
      expect(
        saveIndicator()?.querySelector('[data-save-indicator="danger"]'),
      ).toBeTruthy(),
    )
    expect(tabButton().getAttribute('aria-label')).toBe(
      'Defence.docx, Save failed',
    )
  })

  it('shows a warning icon when the saved work needs its history reloaded', async () => {
    saveStatus = 'blocked'
    renderPane('/matters/mtr_1/documents/doc_1')

    await waitFor(() =>
      expect(
        saveIndicator()?.querySelector('[data-save-indicator="warning"]'),
      ).toBeTruthy(),
    )
    expect(tabButton().getAttribute('aria-label')).toBe(
      'Defence.docx, Saved, history needs a reload',
    )
  })

  it('explains the state in a tooltip the indicator shows on focus', async () => {
    saveStatus = 'unsaved'
    renderPane('/matters/mtr_1/documents/doc_1')

    const indicator = await screen.findByLabelText('Unsaved changes')
    fireEvent.focus(indicator)

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'The work on screen is not in version 1 yet.',
    )
  })

  it('shows the indicator beside the name in the narrow tab switcher', async () => {
    saveStatus = 'unsaved'
    renderPane('/matters/mtr_1/documents/doc_1', true)

    const switcher = await screen.findByRole('button', {
      name: '2 open, Defence.docx, Unsaved changes',
    })
    expect(switcher.querySelector('[data-save-indicator="dot"]')).toBeTruthy()
    fireEvent.click(switcher)
    const item = await screen.findByRole('menuitem', { name: /Defence.docx/ })
    expect(item.querySelector('[data-save-indicator="dot"]')).toBeTruthy()
  })
})

describe('track changes on the tab strip', () => {
  it('names the tracking state beside the open document tab while it is on', async () => {
    tracking = true
    renderPane('/matters/mtr_1/documents/doc_1')

    expect(await screen.findByText('Track changes on')).toBeTruthy()
    expect(document.querySelector('[data-track-changes="on"]')).toBeTruthy()
  })

  it('shows nothing on the strip while tracking is off', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')

    await waitFor(() => expect(tabButton()).toBeTruthy())
    expect(screen.queryByText('Track changes on')).toBeNull()
  })
})

describe('presence on the tab strip', () => {
  it('shows the other people only while a document tab is active', async () => {
    participants = PRESENCE
    const { router } = renderPane('/matters/mtr_1/documents/doc_1')

    expect(
      await screen.findByRole('img', { name: 'Priya Raman, viewing' }),
    ).toBeTruthy()

    await router.navigate({ href: '/matters/mtr_1' })

    await waitFor(() =>
      expect(
        screen.queryByRole('img', { name: 'Priya Raman, viewing' }),
      ).toBeNull(),
    )
  })
})

describe('document actions on the tab strip', () => {
  it('offers the document actions from a document tab context menu', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    fireEvent.contextMenu(
      await screen.findByRole('button', { current: 'page' }),
    )

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete document' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Delete document' }),
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers the document actions from the open-tabs menu', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    fireEvent.click(
      await screen.findByRole('button', { name: 'All open tabs' }),
    )

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete document' }),
    )

    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('keeps the dialog open and says so when the deletion fails', async () => {
    mocks.deleteAsync = vi.fn().mockRejectedValue(new Error('network down'))
    renderPane('/matters/mtr_1/documents/doc_1')
    fireEvent.contextMenu(
      await screen.findByRole('button', { current: 'page' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete document' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete document' }),
    )

    expect(
      await screen.findByText('The document could not be deleted. Try again.'),
    ).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
