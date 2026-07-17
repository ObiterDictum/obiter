// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { DocumentDetailLayoutView } from './views/document-detail'
import type { DocumentDetailResponse } from './documents'

const docs = vi.hoisted(() => ({
  useDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
}))
const currentUser = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
const nav = vi.hoisted(() => ({ useNavigate: vi.fn() }))
const toast = vi.hoisted(() => ({ useToast: vi.fn() }))

vi.mock('./documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./documents')>()
  return {
    ...actual,
    useDocument: docs.useDocument,
    useDeleteDocument: docs.useDeleteDocument,
  }
})

vi.mock('./current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./current-user')>()
  return { ...actual, useCurrentUser: currentUser.useCurrentUser }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: nav.useNavigate }
})

vi.mock('@obiter/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@obiter/ui')>()
  return { ...actual, useToast: toast.useToast }
})

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
})

afterEach(() => {
  cleanup()
})

describe('DocumentDetailLayoutView — matter mismatch', () => {
  it('renders the document details region when the document belongs to the URL matter', async () => {
    docs.useDocument.mockReturnValue(
      successQuery(sampleDocumentDetail('mtr_1')),
    )
    render(<RouterProvider router={buildRouter('mtr_1', 'doc_1')} />)
    await waitFor(() => {
      expect(screen.getByText('Document details')).toBeTruthy()
    })
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
    // The metadata region must not render under the wrong matter.
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
