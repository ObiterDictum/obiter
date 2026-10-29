import '@obiter/test-dom'
import { afterEach, describe, expect, it, beforeEach, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import type { DocumentDetailResponse } from './documents'

const docs = vi.hoisted(() => ({
  useDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
}))
const currentUser = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
const matters = vi.hoisted(() => ({ useMatter: vi.fn() }))
const nav = vi.hoisted(() => ({ useNavigate: vi.fn() }))
const toast = vi.hoisted(() => ({ useToast: vi.fn() }))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useDocument: docs.useDocument,
  useDeleteDocument: docs.useDeleteDocument,
}))

const componentsDocumentWorkspaceWorkspaceModuleKeys = Object.fromEntries(
  Object.keys(await import('./components/document-workspace/workspace')).map(
    (key) => [key, undefined],
  ),
)
mock.module('./components/document-workspace/workspace', () =>
  Object.assign(
    { ...componentsDocumentWorkspaceWorkspaceModuleKeys },
    (() => ({
      DocumentWorkspace: (props: {
        version?: { filename?: string } | null
        document?: { id?: string }
      }) => (
        <div data-workspace-stub data-document={props.document?.id}>
          {props.version?.filename}
        </div>
      ),
    }))(),
  ),
)

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMatter: matters.useMatter,
}))

const currentUserModule = { ...(await import('./current-user')) }
mock.module('./current-user', () => ({
  ...currentUserModule,
  useCurrentUser: currentUser.useCurrentUser,
}))

const tanstackReactRouterModule = {
  ...(await import('@tanstack/react-router')),
}
mock.module('@tanstack/react-router', () => ({
  ...tanstackReactRouterModule,
  useNavigate: nav.useNavigate,
}))

const obiterUiModule = { ...(await import('@obiter/ui')) }
mock.module('@obiter/ui', () => ({
  ...obiterUiModule,
  useToast: toast.useToast,
}))

const { DocumentDetailLayoutView } = await import('./views/document-detail')

function sampleDocumentDetail(matterId: string): DocumentDetailResponse {
  return {
    document: {
      id: 'doc_1',
      organisationId: 'org_1',
      matterId,
      currentVersionId: 'ver_1',
      logicalKey: 'doc_1',
      createdBy: 'usr_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      deletedBy: null,
      currentVersion: {
        id: 'ver_1',
        organisationId: 'org_1',
        matterId,
        matterDocumentId: 'doc_1',
        filename: 'brief.pdf',
        fileType: 'application/pdf',
        sizeBytes: '1024',
        objectKey:
          'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
        textObjectKey: null,
        documentStatus: 'ready',
        failureReason: null,
        versionNumber: 1,
        contentSha256: 'a'.repeat(64),
        syncState: 'synced',
        createdBy: 'usr_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    versions: [],
  }
}

function loadingQuery() {
  return { isLoading: true, isError: false, isSuccess: false, data: undefined }
}
function errorQuery() {
  return { isLoading: false, isError: true, isSuccess: false, data: undefined }
}
function successQuery(data: DocumentDetailResponse) {
  return { isLoading: false, isError: false, isSuccess: true, data }
}

function buildRouter(matterId: string, documentId: string) {
  const rootRoute = createRootRoute()
  const docRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/matters/$matterId/documents/$documentId',
    component: () => (
      <DocumentDetailLayoutView matterId={matterId} documentId={documentId} />
    ),
  })
  return createRouter({
    routeTree: rootRoute.addChildren([docRoute]),
    history: createMemoryHistory({
      initialEntries: [`/matters/${matterId}/documents/${documentId}`],
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  docs.useDeleteDocument.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
  currentUser.useCurrentUser.mockReturnValue({
    data: {
      user: {
        id: 'usr_1',
        email: 'lex@obiter.dev',
        name: 'Lex',
        role: 'owner',
      },
      organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
    },
  })
  nav.useNavigate.mockReturnValue(vi.fn())
  toast.useToast.mockReturnValue({ toast: vi.fn() })
  matters.useMatter.mockReturnValue({
    data: { id: 'mtr_1', name: 'Northgate Foods v Brightwater Packaging' },
  })
})

afterEach(() => {
  cleanup()
})

describe('DocumentDetailLayoutView — matter mismatch', () => {
  it('opens the editor for the document that belongs to the URL matter', async () => {
    docs.useDocument.mockReturnValue(
      successQuery(sampleDocumentDetail('mtr_1')),
    )
    const { container } = render(
      <RouterProvider router={buildRouter('mtr_1', 'doc_1')} />,
    )
    await waitFor(() => {
      expect(container.querySelector('[data-workspace-stub]')).not.toBeNull()
    })
    expect(container.querySelector('[data-workspace-stub]')?.textContent).toBe(
      'brief.pdf',
    )
    expect(screen.queryByText('Document details')).toBeNull()
    expect(screen.getByRole('region', { name: 'Redaction runs' })).toBeTruthy()
  })

  it('renders a mismatch notice instead of the metadata when the document belongs to a different matter', async () => {
    docs.useDocument.mockReturnValue(
      successQuery(sampleDocumentDetail('mtr_real')),
    )
    const { container } = render(
      <RouterProvider router={buildRouter('mtr_wrong', 'doc_1')} />,
    )

    await waitFor(() => {
      expect(
        screen.getByText('This document belongs to a different matter'),
      ).toBeTruthy()
    })
    expect(container.querySelector('h2')?.textContent).not.toBe(
      'Document details',
    )
    expect(screen.queryByText('Document details')).toBeNull()
  })

  it('renders not-found on a document error (not the mismatch path)', async () => {
    docs.useDocument.mockReturnValue(errorQuery())
    render(<RouterProvider router={buildRouter('mtr_1', 'doc_missing')} />)
    await waitFor(() => {
      expect(screen.getByText('Document not found')).toBeTruthy()
    })
  })

  it('renders a loading skeleton while pending', async () => {
    docs.useDocument.mockReturnValue(loadingQuery())
    const { container } = render(
      <RouterProvider router={buildRouter('mtr_1', 'doc_1')} />,
    )
    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    })
  })
})
