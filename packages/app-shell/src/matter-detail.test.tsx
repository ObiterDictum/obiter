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
} from '@tanstack/react-router'
import type { MatterRecord } from './matters'
import type { MatterDocumentRecord } from './documents'

const mocks = vi.hoisted(() => ({
  useMatter: vi.fn(),
  useMatterDocuments: vi.fn(),
  useUploadMatterDocument: vi.fn(),
  useDeleteMatter: vi.fn(),
  useCurrentUser: vi.fn(),
  useNavigate: vi.fn(),
  useToast: vi.fn(),
  blankDocumentFile: vi.fn(),
}))

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMatter: mocks.useMatter,
  useDeleteMatter: mocks.useDeleteMatter,
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useMatterDocuments: mocks.useMatterDocuments,
  useUploadMatterDocument: mocks.useUploadMatterDocument,
}))

const currentUserModule = { ...(await import('./current-user')) }
mock.module('./current-user', () => ({
  ...currentUserModule,
  useCurrentUser: mocks.useCurrentUser,
}))

const documentBlankModuleKeys = Object.fromEntries(
  Object.keys(await import('./document-blank')).map((key) => [key, undefined]),
)
mock.module('./document-blank', () =>
  Object.assign(
    { ...documentBlankModuleKeys },
    {
      blankDocumentFile: mocks.blankDocumentFile,
    },
  ),
)

const tanstackReactRouterModule = {
  ...(await import('@tanstack/react-router')),
}
mock.module('@tanstack/react-router', () => ({
  ...tanstackReactRouterModule,
  useNavigate: mocks.useNavigate,
}))

const obiterUiModule = { ...(await import('@obiter/ui')) }
mock.module('@obiter/ui', () => ({
  ...obiterUiModule,
  useToast: mocks.useToast,
}))

const { MatterRouteView } = await import('./views/matter-detail')

const OWNER = {
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: 'owner' },
  organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
}

const MEMBER = {
  user: {
    id: 'usr_2',
    email: 'junior@obiter.dev',
    name: 'Junior',
    role: 'member',
  },
  organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
}

const at = '2026-01-01T00:00:00.000Z'

function sampleMatter(overrides: Partial<MatterRecord> = {}): MatterRecord {
  return {
    id: 'mtr_1',
    organisationId: 'org_1',
    name: 'Share purchase',
    description: 'Share acquisition of a packaging business.',
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: ['Corporate'],
    clientReference: 'REF-1',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: at,
    updatedAt: '2026-10-26T09:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function sampleDocument(): MatterDocumentRecord {
  return {
    id: 'doc_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    currentVersionId: 'ver_1',
    logicalKey: 'brief.pdf',
    createdBy: 'usr_1',
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: 'ver_1',
      organisationId: 'org_1',
      matterId: 'mtr_1',
      matterDocumentId: 'doc_1',
      filename: 'brief.pdf',
      fileType: 'pdf',
      sizeBytes: '1024',
      objectKey:
        'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber: 2,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: at,
      updatedAt: at,
    },
  }
}

function noDocuments() {
  return { isLoading: false, isPending: false, isError: false, data: [] }
}

function uploadMutationSpy() {
  const mutate = vi.fn()
  return { mutate, isPending: false, error: null }
}

function deleteMutationSpy() {
  const mutateAsync = vi.fn().mockResolvedValue(undefined)
  return { mutateAsync, isPending: false }
}

function buildRouter(matterId: string) {
  const rootRoute = createRootRoute()
  return createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters/$matterId',
        component: () => (
          <QueryClientProvider client={new QueryClient()}>
            <MatterRouteView matterId={matterId} platform="web" />
          </QueryClientProvider>
        ),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters',
        component: () => <div>Matters list</div>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/matters/${matterId}`] }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ runs: [] })),
  )
  mocks.useMatterDocuments.mockReturnValue(noDocuments())
  mocks.useUploadMatterDocument.mockReturnValue(uploadMutationSpy())
  mocks.useDeleteMatter.mockReturnValue(deleteMutationSpy())
  mocks.blankDocumentFile.mockResolvedValue(
    new File(['x'], 'Untitled.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  )
  mocks.useNavigate.mockReturnValue(vi.fn())
  mocks.useToast.mockReturnValue({ toast: vi.fn() })
  mocks.useCurrentUser.mockReturnValue({ data: OWNER })
  mocks.useMatter.mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: sampleMatter(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('matter page header', () => {
  it('shows the matter, its reference, domain and status', async () => {
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Share purchase' }),
    ).toBeTruthy()
    expect(
      screen.getByText('Share acquisition of a packaging business.'),
    ).toBeTruthy()
    expect(screen.getAllByText('REF-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Corporate').length).toBeGreaterThan(0)
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('offers the real actions: upload, new document, share and more', async () => {
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    expect(await screen.findByLabelText('Upload document')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New document' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'More matter actions' }),
    ).toBeTruthy()
  })

  it('offers Share only to the matter owner and More only to a manager', async () => {
    mocks.useCurrentUser.mockReturnValue({ data: MEMBER })
    mocks.useMatterDocuments.mockReturnValue(noDocuments())
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    await screen.findByRole('heading', { level: 1, name: 'Share purchase' })
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'More matter actions' }),
    ).toBeNull()
  })

  it('starts a blank document through the upload path', async () => {
    const upload = uploadMutationSpy()
    mocks.useUploadMatterDocument.mockReturnValue(upload)
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    fireEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await waitFor(() => {
      expect(mocks.blankDocumentFile).toHaveBeenCalled()
      expect(upload.mutate).toHaveBeenCalled()
    })
  })
})

describe('matter documents', () => {
  it('lists a document with its version and opens the document route', async () => {
    mocks.useMatterDocuments.mockReturnValue({
      isLoading: false,
      isPending: false,
      isError: false,
      data: [sampleDocument()],
    })
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    const link = await screen.findByRole('link', { name: /^brief\.pdf/ })
    expect(link.getAttribute('href')).toBe('/matters/mtr_1/documents/doc_1')
    expect(screen.getByText('Version 2 · PDF')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open brief.pdf' })).toBeTruthy()
  })

  it('accepts DOCX, PDF and TXT uploads', async () => {
    render(<RouterProvider router={buildRouter('mtr_1')} />)
    const input = await screen.findByLabelText('Upload document')
    expect(input).toHaveProperty('accept', expect.stringContaining('.pdf'))
    expect(input).toHaveProperty('accept', expect.stringContaining('.docx'))
  })

  it('offers an empty state with both ways in, not a bare empty table', async () => {
    render(<RouterProvider router={buildRouter('mtr_1')} />)
    expect(await screen.findByText('No documents yet')).toBeTruthy()
    expect(screen.getByLabelText('Upload document')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New document' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a documents failure instead of an empty list', async () => {
    mocks.useMatterDocuments.mockReturnValue({
      isLoading: false,
      isPending: false,
      isError: true,
      data: undefined,
    })
    render(<RouterProvider router={buildRouter('mtr_1')} />)
    expect(
      await screen.findByText(/The documents could not be loaded/),
    ).toBeTruthy()
  })
})

describe('delete matter', () => {
  it('confirms through the overflow menu and states the cascade', async () => {
    const deleteSpy = deleteMutationSpy()
    mocks.useDeleteMatter.mockReturnValue(deleteSpy)
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'More matter actions' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete matter' }),
    )

    expect(await screen.findByText(/removes 0 documents/i)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Delete matter' })
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(deleteSpy.mutateAsync).toHaveBeenCalledWith('mtr_1')
    })
  })

  it('waits for the document count before enabling confirmation', async () => {
    mocks.useMatterDocuments.mockReturnValue({
      isLoading: true,
      isPending: true,
      isError: false,
      data: undefined,
    })
    render(<RouterProvider router={buildRouter('mtr_1')} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'More matter actions' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete matter' }),
    )

    expect(
      await screen.findByText('Loading the document count before deletion.'),
    ).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Delete matter' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
  })
})
