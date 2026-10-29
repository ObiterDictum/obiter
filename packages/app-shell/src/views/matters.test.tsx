import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
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
} from '@tanstack/react-router'
import { ToastProvider } from '@obiter/ui'
import type { MatterRecord } from '../matters'
import type { MatterDocumentRecord } from '../documents'

const mocks = vi.hoisted(() => ({
  useMattersList: vi.fn(),
  useRedactionRunsList: vi.fn(),
  useOrganisationVerificationRuns: vi.fn(),
}))

const mattersModule = { ...(await import('../matters')) }
mock.module('../matters', () => ({
  ...mattersModule,
  useMattersList: mocks.useMattersList,
}))

const redactionModule = { ...(await import('../redaction-runs')) }
mock.module('../redaction-runs', () => ({
  ...redactionModule,
  useRedactionRunsList: mocks.useRedactionRunsList,
}))

const verificationModule = { ...(await import('../verification-runs')) }
mock.module('../verification-runs', () => ({
  ...verificationModule,
  useOrganisationVerificationRuns: mocks.useOrganisationVerificationRuns,
}))

const { MattersRouteView } = await import('./matters')

const at = '2026-10-25T09:00:00.000Z'
const northgate = /^Northgate Foods v Brightwater Packaging/
const okafor = /^Okafor v Lumen Logistics/

function matter(overrides: Partial<MatterRecord> = {}): MatterRecord {
  return {
    id: 'mtr_1',
    organisationId: 'org_1',
    name: 'Northgate Foods v Brightwater Packaging',
    description: null,
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: ['Commercial contracts'],
    clientReference: 'NGF-0418',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function document(
  matterId: string,
  id: string,
  filename: string,
  updatedAt = at,
): MatterDocumentRecord {
  return {
    id,
    organisationId: 'org_1',
    matterId,
    currentVersionId: `ver_${id}`,
    logicalKey: filename,
    createdBy: 'usr_1',
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: `ver_${id}`,
      organisationId: 'org_1',
      matterId,
      matterDocumentId: id,
      filename,
      fileType: 'docx',
      sizeBytes: '1024',
      objectKey: `org/org_1/matters/${matterId}/documents/${id}/versions/1/source`,
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber: 2,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: updatedAt,
      updatedAt,
    },
  }
}

function buildRouter() {
  const rootRoute = createRootRoute()
  return createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters',
        component: () => (
          <QueryClientProvider client={new QueryClient()}>
            <ToastProvider>
              <MattersRouteView platform="web" />
            </ToastProvider>
          </QueryClientProvider>
        ),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters/$matterId',
        component: () => <div>Matter page</div>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/matters'] }),
  })
}

const matters = [
  matter(),
  matter({
    id: 'mtr_2',
    name: 'Okafor v Lumen Logistics',
    clientReference: 'OKA-0233',
    legalDomains: ['Employment'],
    updatedAt: '2026-10-21T10:05:00.000Z',
  }),
]

const documents: Record<string, MatterDocumentRecord[]> = {
  '/api/matters/mtr_1/documents': [
    document(
      'mtr_1',
      'doc_1',
      'advice-note-northgate.docx',
      '2026-10-26T11:30:00.000Z',
    ),
    document('mtr_1', 'doc_2', 'supply-agreement-northgate.docx'),
  ],
  '/api/matters/mtr_2/documents': [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path.endsWith('/verification-runs')) {
        return Response.json({ runs: [], nextCursor: null })
      }
      const body = documents[path]
      return body
        ? Response.json({ documents: body })
        : Response.json({ error: 'not found' }, { status: 404 })
    }),
  )
  mocks.useMattersList.mockReturnValue({
    data: matters,
    isPending: false,
    isError: false,
    isSuccess: true,
  })
  mocks.useRedactionRunsList.mockReturnValue({
    data: { runs: [] },
    isPending: false,
    isError: false,
    isSuccess: true,
  })
  mocks.useOrganisationVerificationRuns.mockReturnValue({
    runs: [
      {
        id: 'vrun_1',
        organisationId: 'org_1',
        matterId: 'mtr_1',
        documentId: 'doc_1',
        documentVersionId: 'ver_doc_1',
        status: 'completed',
        failureCode: null,
        createdBy: 'usr_1',
        createdAt: at,
        startedAt: at,
        completedAt: at,
        summary: {
          findingCount: 3,
          flaggedCount: 1,
          reviewRequiredCount: 2,
          dismissedCount: 0,
          notCheckedCount: 0,
        },
        documentCurrentVersionId: 'ver_doc_1',
        stale: false,
      },
    ],
    isSuccess: true,
    isError: false,
    isPending: false,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('matters list', () => {
  it('lists every matter with its documents, open work and last activity', async () => {
    render(<RouterProvider router={buildRouter()} />)

    const row = await screen.findByRole('button', { name: northgate })
    expect(row).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByText('NGF-0418')).toBeTruthy()
    expect(within(table).getByText('Commercial contracts')).toBeTruthy()
    expect(await screen.findByText('1 flagged')).toBeTruthy()
    expect(screen.getByText('2 need review')).toBeTruthy()
    await waitFor(() => {
      expect(within(table).getAllByText('2').length).toBeGreaterThan(0)
    })
    expect(
      screen.getByRole('link', { name: 'Open Okafor v Lumen Logistics' }),
    ).toBeTruthy()
    expect(screen.getByText('No open work')).toBeTruthy()
  })

  it('filters by search, legal domain and open work', async () => {
    render(<RouterProvider router={buildRouter()} />)
    await screen.findByRole('button', { name: northgate })

    fireEvent.change(screen.getByLabelText('Search matters'), {
      target: { value: 'okafor' },
    })
    expect(screen.queryByRole('button', { name: northgate })).toBeNull()
    expect(screen.getByRole('button', { name: okafor })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search matters'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Employment/ }))
    expect(screen.queryByRole('button', { name: northgate })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^All matters/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Needs attention/ }))
    expect(screen.getByRole('button', { name: northgate })).toBeTruthy()
    expect(screen.queryByRole('button', { name: okafor })).toBeNull()
  })

  it('updates the preview from the selected row and links to the matter', async () => {
    render(<RouterProvider router={buildRouter()} />)
    fireEvent.click(await screen.findByRole('button', { name: okafor }))

    const preview = await screen.findByRole('region', {
      name: 'Okafor v Lumen Logistics',
    })
    expect(
      within(preview)
        .getByRole('link', { name: 'Open matter' })
        .getAttribute('href'),
    ).toBe('/matters/mtr_2')
    expect(within(preview).getByText('No documents yet.')).toBeTruthy()
  })

  it('says when filters match nothing and clears them', async () => {
    render(<RouterProvider router={buildRouter()} />)
    await screen.findByRole('button', { name: northgate })
    fireEvent.change(screen.getByLabelText('Search matters'), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText('No matter matches these filters.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('button', { name: northgate })).toBeTruthy()
  })

  it('offers the empty state before the first matter exists', async () => {
    mocks.useMattersList.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
    })
    render(<RouterProvider router={buildRouter()} />)
    expect(await screen.findByText('No matters yet')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Create the first matter' }),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
