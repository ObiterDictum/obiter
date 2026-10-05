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
const nav = vi.hoisted(() => ({ useNavigate: vi.fn() }))
const toast = vi.hoisted(() => ({ useToast: vi.fn() }))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const documentsModule = { ...(await import('./documents')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const documentsModuleKeys = Object.fromEntries(
  Object.keys(await import('./documents')).map((key) => [key, undefined]),
)
mock.module('./documents', () =>
  Object.assign(
    { ...documentsModuleKeys },
    (() => {
      const actual = documentsModule
      return {
        ...actual,
        useDocument: docs.useDocument,
        useDeleteDocument: docs.useDeleteDocument,
      }
    })(),
  ),
)

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const componentsDocumentWorkspaceWorkspaceModuleKeys = Object.fromEntries(
  Object.keys(await import('./components/document-workspace/workspace')).map(
    (key) => [key, undefined],
  ),
)
mock.module('./components/document-workspace/workspace', () =>
  Object.assign(
    { ...componentsDocumentWorkspaceWorkspaceModuleKeys },
    (() => ({
      DocumentWorkspace: () => null,
    }))(),
  ),
)

// The former vi.mock('./components/verification-run-panel') is gone: that
// module does not exist and nothing under src imports it, so vitest tolerated
// a dead mock while bun resolves the specifier and fails the file. Removing it
// changes no behaviour.

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const currentUserModule = { ...(await import('./current-user')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const currentUserModuleKeys = Object.fromEntries(
  Object.keys(await import('./current-user')).map((key) => [key, undefined]),
)
mock.module('./current-user', () =>
  Object.assign(
    { ...currentUserModuleKeys },
    (() => {
      const actual = currentUserModule
      return { ...actual, useCurrentUser: currentUser.useCurrentUser }
    })(),
  ),
)

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const tanstackReactRouterModule = {
  ...(await import('@tanstack/react-router')),
}
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const tanstackReactRouterModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...tanstackReactRouterModuleKeys },
    (() => {
      const actual = tanstackReactRouterModule
      return { ...actual, useNavigate: nav.useNavigate }
    })(),
  ),
)

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const obiterUiModule = { ...(await import('@obiter/ui')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const obiterUiModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/ui')).map((key) => [key, undefined]),
)
mock.module('@obiter/ui', () =>
  Object.assign(
    { ...obiterUiModuleKeys },
    (() => {
      const actual = obiterUiModule
      return { ...actual, useToast: toast.useToast }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
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
