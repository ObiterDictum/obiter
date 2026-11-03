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
import { ToastProvider } from '@obiter/ui'
import type { MatterRecord } from './matters'
import type { CitationTarget } from '@obiter/contracts'

const mocks = vi.hoisted(() => ({
  matters: [] as MatterRecord[],
  documents: [] as CitationTarget[],
  uploadRequest: vi.fn(),
  createMatter: vi.fn(),
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

const otherMatter: MatterRecord = {
  ...matter,
  id: 'mtr_2',
  name: 'Ashcroft Probate',
  clientReference: 'HP-2026-0401',
  updatedAt: '2026-10-05T09:00:00.000Z',
}

const citationTarget: CitationTarget = {
  documentId: 'doc_1',
  matterId: 'mtr_1',
  matterName: 'Smith v Jones Lettings Ltd',
  filename: 'Defence and Counterclaim.docx',
  fileType: 'docx',
  openedAt: '2026-10-06T09:00:00.000Z',
  canEdit: true,
}

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMattersList: () => ({ data: mocks.matters }),
  useCreateMatter: () => ({
    mutateAsync: mocks.createMatter,
    isPending: false,
  }),
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useCitationTargets: () => ({ data: mocks.documents }),
  useRecentlyOpenedDocument: () => ({ data: null }),
  uploadMatterDocumentRequest: mocks.uploadRequest,
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

const blankModule = { ...(await import('./document-blank')) }
mock.module('./document-blank', () => ({
  ...blankModule,
  blankDocumentFile: async () => new File(['blank'], 'Blank document.docx'),
}))

const { CommandPaletteProvider, useCommandPalette } =
  await import('./command-palette')

function LocationProbe() {
  const location = useRouterState({ select: (state) => state.location })
  return (
    <p data-testid="location">
      {location.pathname}
      {location.searchStr}
    </p>
  )
}

function PaletteTrigger() {
  const openPalette = useCommandPalette()
  return (
    <button
      type="button"
      aria-label="Search Obiter"
      onClick={(event) => openPalette(event.currentTarget)}
    >
      Search Obiter
    </button>
  )
}

function renderPalette(initialEntry = '/matters/mtr_1') {
  const rootRoute = createRootRoute()
  const page = () => (
    <CommandPaletteProvider
      onToggleNav={() => {}}
      onToggleRightSlot={() => {}}
      onToggleFocusMode={() => {}}
    >
      <PaletteTrigger />
      <LocationProbe />
    </CommandPaletteProvider>
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      [
        '/',
        '/matters',
        '/matters/$matterId',
        '/matters/$matterId/documents/$documentId',
        '/redact',
        '/redact/$runId',
        '/verify',
        '/search',
      ].map((path) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path,
          component: page,
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: { queryClient: new QueryClient() },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return router
}

async function openPalette() {
  fireEvent.click(await screen.findByRole('button', { name: 'Search Obiter' }))
  return screen.findByRole('combobox', { name: 'Search Obiter' })
}

beforeEach(() => {
  mocks.matters = [matter, otherMatter]
  mocks.documents = [citationTarget]
  mocks.uploadRequest.mockReset()
  mocks.uploadRequest.mockResolvedValue({
    document: { id: 'doc_9', logicalKey: 'blank', currentVersion: null },
    version: { filename: 'Blank document.docx' },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('command palette', () => {
  it('opens from the title bar field and closes on Escape returning focus', async () => {
    renderPalette()
    const trigger = await screen.findByRole('button', { name: 'Search Obiter' })
    const input = await openPalette()
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('filters matters and documents as you type', async () => {
    renderPalette()
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'defence' } })
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent).join(' ')).toContain(
      'Defence and Counterclaim.docx',
    )
    expect(options.map((option) => option.textContent).join(' ')).not.toContain(
      'Ashcroft Probate',
    )
  })

  it('opens the highlighted row with Enter', async () => {
    const router = renderPalette()
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'ashcroft' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/matters/mtr_2'),
    )
  })

  it('opens a link row in a new tab on the primary modifier plus Enter', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderPalette()
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'smith' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]?.[0]).toContain('/matters/mtr_1')
    open.mockRestore()
  })

  it('opens the create matter dialog from the palette', async () => {
    renderPalette()
    await openPalette()
    fireEvent.click(await screen.findByText('New matter'))
    expect(await screen.findByText('Create a matter')).toBeTruthy()
  })

  it('asks which matter to upload into when no matter is open', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderPalette('/matters')
    await openPalette()
    fireEvent.click(await screen.findByText('Upload document'))
    expect(await screen.findByText('Choose a matter')).toBeTruthy()
    fireEvent.click(await screen.findByText('Ashcroft Probate'))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('uploads straight into the open matter', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderPalette('/matters/mtr_1')
    await openPalette()
    fireEvent.click(await screen.findByText('Upload document'))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('creates a blank document in the open matter', async () => {
    renderPalette('/matters/mtr_1')
    await openPalette()
    fireEvent.click(await screen.findByText('New blank document'))
    await waitFor(() => expect(mocks.uploadRequest).toHaveBeenCalledTimes(1))
    expect(mocks.uploadRequest.mock.calls[0]?.[0]).toBe('mtr_1')
  })

  it('runs the law search from the palette row', async () => {
    const router = renderPalette('/matters/mtr_1')
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'unfair dismissal' } })
    fireEvent.click(
      await screen.findByText(
        'Case law and legislation for “unfair dismissal”',
      ),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
    expect(router.state.location.searchStr).toContain('unfair')
  })

  it('runs the action rows for the shell toggles', async () => {
    const toggles = { nav: 0, slot: 0, focus: 0 }
    const rootRoute = createRootRoute()
    function Harness() {
      return (
        <CommandPaletteProvider
          onToggleNav={() => {
            toggles.nav += 1
          }}
          onToggleRightSlot={() => {
            toggles.slot += 1
          }}
          onToggleFocusMode={() => {
            toggles.focus += 1
          }}
        >
          <PaletteTrigger />
        </CommandPaletteProvider>
      )
    }
    const router = createRouter({
      routeTree: rootRoute.addChildren([
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/',
          component: Harness,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient: new QueryClient() },
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await openPalette()
    fireEvent.click(await screen.findByText('Toggle sidebar'))
    expect(toggles.nav).toBe(1)
  })
})
