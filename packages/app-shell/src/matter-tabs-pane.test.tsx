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
import type { MatterDocumentRecord } from './documents'

const mocks = vi.hoisted(() => ({
  documents: [] as MatterDocumentRecord[],
  verified: [] as string[],
  redacted: [] as string[],
  promotionRenders: 0,
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
}))

const redactionModule = { ...(await import('./redaction-runs')) }
mock.module('./redaction-runs', () => ({
  ...redactionModule,
  useRedactionRunsList: () => ({ data: { runs: [] }, isPending: false }),
  useCreateMatterRedactionRun: () => ({
    mutateAsync: async (documentId: string) => {
      mocks.redacted.push(documentId)
      return { run: { id: 'red_1' } }
    },
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
  useCreateVerificationRun: (documentId: string) => ({
    isPending: false,
    mutate: (versionId: string, options?: { onSuccess?: () => void }) => {
      mocks.verified.push(`${documentId}:${versionId}`)
      options?.onSuccess?.()
    },
  }),
}))

const { ContentsPanel } = await import('./contents-panel')
const { MatterTabsPane } = await import('./matter-split')
const { MatterPreviewProvider } = await import('./matter-preview')
const { matterTabStorageKey } = await import('./matter-tabs')
const { useMatterTabs } = await import('./matter-tabs-state')

function PromotionControl() {
  const tabs = useMatterTabs()
  mocks.promotionRenders += 1
  return <button onClick={tabs.promoteActive}>Mark document edited</button>
}

function Pane({ platform }: { platform: 'web' | 'desktop' }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return (
    <MatterPreviewProvider>
      <div className="flex">
        <ContentsPanel section="matters" pathname={pathname} overlay={false} />
        <MatterTabsPane
          matterId="mtr_1"
          userId="usr_1"
          platform={platform}
          compact={false}
        >
          <p data-testid="page">{pathname}</p>
          <input aria-label="Note" />
          <PromotionControl />
        </MatterTabsPane>
      </div>
    </MatterPreviewProvider>
  )
}

function renderPane(path: string, platform: 'web' | 'desktop' = 'web') {
  const rootRoute = createRootRoute()
  const component = () => <Pane platform={platform} />
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

function openTabs() {
  return Array.from(
    document.querySelectorAll('[aria-label="Open in this matter"] [draggable]'),
  ).map((element) => element.textContent ?? '')
}

function pagePath() {
  return screen.getByTestId('page').textContent
}

async function clickContents(filename: string) {
  fireEvent.click(
    await screen.findByRole('link', { name: new RegExp(filename) }),
  )
  await waitFor(() => {
    expect(pagePath()).toContain('/documents/')
  })
}

beforeEach(() => {
  mocks.documents = [
    documentFixture('doc_1', 'Defence.docx'),
    documentFixture('doc_2', 'Witness.docx'),
    documentFixture('doc_3', 'Advice.docx'),
  ]
  mocks.verified = []
  mocks.redacted = []
  mocks.promotionRenders = 0
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('matter tab strip', () => {
  it('promoting a permanent tab does not notify its editor again', async () => {
    renderPane('/matters/mtr_1')
    await clickContents('Defence.docx')
    const promote = await screen.findByRole('button', {
      name: 'Mark document edited',
    })
    fireEvent.click(promote)
    const renders = mocks.promotionRenders
    fireEvent.click(promote)
    expect(mocks.promotionRenders).toBe(renders)
    await clickContents('Witness.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(3))
  })

  it('shows the matter overview as a home icon named after the matter', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    const overview = await screen.findByRole('button', {
      name: 'Smith v Jones Lettings Ltd',
    })
    expect(overview.textContent).toBe('')
    expect(overview.querySelector('svg')).toBeTruthy()
    fireEvent.focus(overview)
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Smith v Jones Lettings Ltd',
    )
  })

  it('opens a tab for the route and marks it as the current one', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    const current = await screen.findByRole('button', { current: 'page' })
    expect(current.textContent).toBe('Defence.docx')
    expect(openTabs()).toHaveLength(2)
  })

  it('previews from the contents panel and replaces the preview on the next click', async () => {
    renderPane('/matters/mtr_1')
    await waitFor(() => expect(openTabs()).toHaveLength(1))
    await clickContents('Defence.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    await clickContents('Witness.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    expect(openTabs().join(' ')).toContain('Witness.docx')
    expect(openTabs().join(' ')).not.toContain('Defence.docx')
  })

  it('keeps a preview tab once it is promoted by a double click', async () => {
    renderPane('/matters/mtr_1')
    await clickContents('Defence.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    const preview = await screen.findByRole('button', { current: 'page' })
    fireEvent.doubleClick(preview)
    await clickContents('Witness.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(3))
  })

  it('moves to the neighbour when the current tab closes and falls back to the overview', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close Defence.docx' }),
    )
    await waitFor(() => expect(pagePath()).toBe('/matters/mtr_1'))
    expect(openTabs()).toHaveLength(1)
  })

  it('pins the overview tab, so it offers no close control at all', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    expect(
      screen.queryByRole('button', {
        name: 'Close Smith v Jones Lettings Ltd',
      }),
    ).toBeNull()
    fireEvent.contextMenu(
      await screen.findByRole('button', { name: 'Smith v Jones Lettings Ltd' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Open to the side' }),
    ).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: 'Close tab' })).toBeNull()
  })

  it('restores the tab set after a reload', async () => {
    const first = renderPane('/matters/mtr_1/documents/doc_1')
    await clickContents('Witness.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(3))
    const stored = window.localStorage.getItem(
      matterTabStorageKey('usr_1', 'mtr_1'),
    )
    expect(stored).not.toBeNull()
    first.unmount()
    renderPane('/matters/mtr_1/documents/doc_1')
    await waitFor(() => expect(openTabs()).toHaveLength(3))
    expect(openTabs().join(' ')).toContain('Witness.docx')
  })

  it('opens a document to the side and keeps the split in the URL', async () => {
    const first = renderPane('/matters/mtr_1/documents/doc_1')
    await clickContents('Witness.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(3))
    const witness = await screen.findByRole('button', { current: 'page' })
    fireEvent.contextMenu(witness)
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Open to the side' }),
    )
    await waitFor(() =>
      expect(first.router.state.location.searchStr).toContain(
        'side=document%3Adoc_2',
      ),
    )
    expect(
      await screen.findByRole('region', { name: /Witness.docx, read only/ }),
    ).toBeDefined()
    const splitPath = `${first.router.state.location.pathname}${first.router.state.location.searchStr}`
    first.unmount()
    renderPane(splitPath)
    expect(
      await screen.findByRole('region', { name: /Witness.docx, read only/ }),
    ).toBeDefined()
  })

  it('resets the split to even on a double click of the divider', async () => {
    renderPane('/matters/mtr_1/documents/doc_1?side=document%3Adoc_2')
    const divider = await screen.findByRole('separator', {
      name: 'Resize split view',
    })
    expect(divider.getAttribute('aria-valuenow')).toBe('50')
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(divider.getAttribute('aria-valuenow')).toBe('62'),
    )
    fireEvent.doubleClick(divider)
    await waitFor(() =>
      expect(divider.getAttribute('aria-valuenow')).toBe('50'),
    )
  })

  it('swaps the editable document with the read-only side', async () => {
    const first = renderPane('/matters/mtr_1/documents/doc_1')
    await clickContents('Witness.docx')
    await waitFor(() => expect(openTabs()).toHaveLength(3))
    const witness = await screen.findByRole('button', { current: 'page' })
    fireEvent.contextMenu(witness)
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Open to the side' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Defence.docx' }))
    await waitFor(() =>
      expect(first.router.state.location.pathname).toBe(
        '/matters/mtr_1/documents/doc_1',
      ),
    )

    const side = await screen.findByRole('region', {
      name: /Witness.docx, read only/,
    })
    expect(side.textContent).toContain('Read only')
    fireEvent.click(within(side).getByRole('button', { name: 'Swap sides' }))

    await waitFor(() =>
      expect(first.router.state.location.pathname).toBe(
        '/matters/mtr_1/documents/doc_2',
      ),
    )
    expect(first.router.state.location.searchStr).toContain(
      'side=document%3Adoc_1',
    )
  })

  it('selects tabs with the platform shortcut and ignores keys while typing', async () => {
    renderPane('/matters/mtr_1/documents/doc_1', 'desktop')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    await waitFor(() => expect(pagePath()).toBe('/matters/mtr_1'))
    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    await waitFor(() =>
      expect(pagePath()).toBe('/matters/mtr_1/documents/doc_1'),
    )
    const note = await screen.findByLabelText('Note')
    fireEvent.keyDown(note, { key: '1', ctrlKey: true })
    await waitFor(() =>
      expect(pagePath()).toBe('/matters/mtr_1/documents/doc_1'),
    )
  })

  it('leaves the shortcut alone on the web build', async () => {
    renderPane('/matters/mtr_1/documents/doc_1', 'web')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pagePath()).toBe('/matters/mtr_1/documents/doc_1')
  })

  it('offers the four new-item flows with single-letter accelerators', async () => {
    renderPane('/matters/mtr_1')
    fireEvent.click(
      await screen.findByRole('button', { name: 'New in this matter' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: /Blank document/ }),
    ).toBeDefined()
    expect(
      screen.getByRole('menuitem', { name: /Upload documents/ }),
    ).toBeDefined()
    expect(
      screen.getByRole('menuitem', { name: /Verify a document/ }),
    ).toBeDefined()
    expect(
      screen.getByRole('menuitem', { name: /Redact a document/ }),
    ).toBeDefined()
  })

  it('starts a verify run for the open document and opens the Verify tab', async () => {
    renderPane('/matters/mtr_1/documents/doc_1')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    fireEvent.click(
      await screen.findByRole('button', { name: 'New in this matter' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Verify Defence.docx/ }),
    )
    await waitFor(() => expect(mocks.verified).toEqual(['doc_1:ver_doc_1']))
    await waitFor(() => expect(pagePath()).toBe('/matters/mtr_1/verify'))
    expect(openTabs().join(' ')).toContain('Verify')
  })

  it('starts a redaction run for the open document and opens its tab', async () => {
    renderPane('/matters/mtr_1/documents/doc_3')
    await waitFor(() => expect(openTabs()).toHaveLength(2))
    fireEvent.click(
      await screen.findByRole('button', { name: 'New in this matter' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Redact Advice.docx/ }),
    )
    await waitFor(() => expect(mocks.redacted).toEqual(['doc_3']))
    await waitFor(() => expect(pagePath()).toBe('/matters/mtr_1/redact/red_1'))
    expect(openTabs().join(' ')).toContain('Advice.docx')
  })
})
