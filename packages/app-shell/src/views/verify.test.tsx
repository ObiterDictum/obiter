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
import type {
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import type { MatterRecord } from '../matters'
import type { MatterDocumentRecord } from '../documents'

const mocks = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
const currentUserModule = { ...(await import('../current-user')) }
mock.module('../current-user', () => ({
  ...currentUserModule,
  useCurrentUser: mocks.useCurrentUser,
}))

// Loaded after the registration above.
const { VerifyRouteView } = await import('./verify')

const at = '2026-10-26T09:02:00.000Z'

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
  currentVersionNumber: number,
): MatterDocumentRecord {
  return {
    id,
    organisationId: 'org_1',
    matterId,
    currentVersionId: `ver_${id}_${String(currentVersionNumber)}`,
    logicalKey: filename,
    createdBy: 'usr_1',
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: `ver_${id}_${String(currentVersionNumber)}`,
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
      versionNumber: currentVersionNumber,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: at,
      updatedAt: at,
    },
  }
}

function run(overrides: Partial<VerificationRun> = {}): VerificationRun {
  return {
    id: 'vrun_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_doc_1_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: at,
    startedAt: at,
    completedAt: at,
    summary: {
      findingCount: 3,
      flaggedCount: 1,
      reviewRequiredCount: 1,
      notCheckedCount: 0,
      dismissedCount: 0,
    },
    documentCurrentVersionId: 'ver_doc_1_1',
    stale: false,
    ...overrides,
  }
}

function finding(
  overrides: Partial<VerificationFindingView> = {},
): VerificationFindingView {
  return {
    id: 'vf_clear',
    type: 'citation_resolution',
    state: 'clear',
    dismissal: null,
    reviewReason: null,
    severity: null,
    confidence: null,
    requiresReview: false,
    explanation: 'The citation resolved to one stored authority.',
    excerpt: '[2017] UKSC 24',
    location: { paragraphId: 'p1', start: 0, end: 13 },
    authorityLabel: '[2017] UKSC 24',
    authorityName: null,
    evidence: [
      {
        id: 'd-wood:judgment_paragraph:10',
        sourceId: 'd-wood',
        label: 'Judgment d-wood, paragraph 10',
        source: {
          url: 'https://caselaw.nationalarchives.gov.uk/uksc/2017/24',
          canonicalUrl: '/case/wood-v-capita-2017-uksc-24',
          pinpoint: 'judgment [10]',
          anchor: 'para-10',
        },
      },
    ],
    ...overrides,
  }
}

const flagged = finding({
  id: 'vf_flagged',
  state: 'flagged',
  authorityLabel: 'Rock Advertising Ltd v MWB [2018] UKSC 24',
  authorityName: null,
  excerpt: '[2018] UKSC 24',
  explanation: 'The citation names a different authority from the case named.',
})

const needsReview = finding({
  id: 'vf_review',
  type: 'quote_fidelity',
  state: 'review_required',
  reviewReason: 'citation_unresolved',
  authorityLabel: 'Unmatched citation',
  authorityName: null,
  excerpt: '[2099] UKSC 9',
  explanation: 'The quotation could not be attributed.',
  evidence: [],
})

let runs: VerificationRun[]
let findings: VerificationFindingView[]
let dismissals: string[]
let reopenals: string[]
let dismissFails = false

function fulfil(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function jsonBody(init?: RequestInit) {
  return init?.body ? JSON.parse(String(init.body)) : {}
}

beforeEach(() => {
  vi.clearAllMocks()
  runs = [run()]
  findings = [flagged, needsReview, finding()]
  dismissals = []
  reopenals = []
  dismissFails = false
  mocks.useCurrentUser.mockReturnValue({
    data: {
      user: {
        id: 'usr_1',
        email: 'alex@example.com',
        name: 'Alex',
        role: 'owner',
      },
      organisation: {
        id: 'org_1',
        name: 'Harrington Vale LLP',
        plan: 'private_beta',
      },
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === '/api/matters') {
        return fulfil({ matters: [matter()] })
      }
      if (path === '/api/verification-runs') {
        return fulfil({ runs, nextCursor: null })
      }
      if (path === '/api/documents/doc_1') {
        return fulfil({
          document: document('mtr_1', 'doc_1', 'advice-note-northgate.docx', 2),
          versions: [
            {
              ...document('mtr_1', 'doc_1', 'advice-note-northgate.docx', 1)
                .currentVersion!,
              id: 'ver_doc_1_1',
              versionNumber: 1,
            },
            document('mtr_1', 'doc_1', 'advice-note-northgate.docx', 2)
              .currentVersion!,
          ],
        })
      }
      const dismiss = path.match(
        /^\/api\/verification-runs\/([^/]+)\/findings\/([^/]+)\/dismiss$/,
      )
      if (dismiss) {
        if (dismissFails) {
          return fulfil(
            {
              error: {
                code: 'verification_run_not_found',
                message: 'Verification finding not found.',
                requestId: 'req',
              },
            },
            404,
          )
        }
        const findingId = decodeURIComponent(dismiss[2]!)
        if (init?.method === 'DELETE') {
          reopenals.push(findingId)
          findings = findings.map((item) =>
            item.id === findingId ? { ...item, dismissal: null } : item,
          )
          return new Response(null, { status: 204 })
        }
        const body = jsonBody(init) as { reason?: string }
        dismissals.push(findingId)
        const dismissal = {
          reason: body.reason ?? null,
          dismissedBy: 'usr_1',
          dismissedByName: 'Priya Shah',
          dismissedAt: at,
        }
        findings = findings.map((item) =>
          item.id === findingId ? { ...item, dismissal } : item,
        )
        return fulfil({ dismissal }, 201)
      }
      const findingsPage = path.match(
        /^\/api\/verification-runs\/([^/]+)\/findings$/,
      )
      if (findingsPage) {
        return fulfil({ run: runs[0], findings, nextCursor: null })
      }
      return fulfil(
        {
          error: {
            code: 'document_not_found',
            message: 'No route',
            requestId: 'req',
          },
        },
        404,
      )
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function buildRouter() {
  const rootRoute = createRootRoute()
  return createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/verify',
        component: () => (
          <QueryClientProvider
            client={
              new QueryClient({
                defaultOptions: { queries: { retry: false } },
              })
            }
          >
            <ToastProvider>
              <VerifyRouteView />
            </ToastProvider>
          </QueryClientProvider>
        ),
      }),
      ...[
        '/matters',
        '/settings',
        '/matters/$matterId/documents/$documentId',
        '/case/$caseSlug',
        '/ln/$',
      ].map((path) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path,
          component: () => <div>Elsewhere</div>,
        }),
      ),
    ]),
    history: createMemoryHistory({ initialEntries: ['/verify'] }),
  })
}

async function renderVerify() {
  render(<RouterProvider router={buildRouter()} />)
  await screen.findByRole('heading', { name: 'Verify' })
}

describe('VerifyRouteView', () => {
  it('groups findings by matter and document and names the version it checked', async () => {
    await renderVerify()
    expect(
      await screen.findByText('Northgate Foods v Brightwater Packaging'),
    ).toBeTruthy()
    expect(screen.getByText('NGF-0418')).toBeTruthy()
    expect(screen.getByText('advice-note-northgate.docx')).toBeTruthy()
    expect(screen.getAllByText(/1 flagged/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 needs review/).length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/1 matches the checked source/).length,
    ).toBeGreaterThan(0)
  })

  it('says plainly that the checked version is older than the one stored now', async () => {
    runs = [run({ stale: true, documentCurrentVersionId: 'ver_doc_1_2' })]
    await renderVerify()
    expect(
      await screen.findByText(
        /Checked version 1\. Version 2 is stored now, so this result covers the earlier text, not the current one\./,
      ),
    ).toBeTruthy()
  })

  it('folds the matches behind one line, and states each limit once', async () => {
    await renderVerify()
    // A run's matches are the bulk of a healthy check and the least urgent to
    // read, so they arrive as one line the reader can open.
    await screen.findByText('advice-note-northgate.docx')
    const show = await screen.findByRole('button', {
      name: /matches? the checked source/,
    })
    expect(screen.queryByText('Citation matches checked source')).toBeNull()
    expect(show.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(show)
    expect(show.getAttribute('aria-expanded')).toBe('true')
    expect(
      await screen.findByText('Citation matches checked source'),
    ).toBeTruthy()
    expect(screen.getAllByText('Flagged').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0)
    // The check's own sentence is the only statement of the limit on the card.
    expect(
      screen.getAllByText('The quotation could not be attributed.').length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText(/The citation did not match a stored source\. It may/),
    ).toBeNull()
  })

  it('links the stored source page and its pinpoint', async () => {
    await renderVerify()
    const link = (
      await screen.findAllByRole('link', { name: 'Open judgment' })
    )[0]!
    expect(link.getAttribute('href')).toBe(
      '/case/wood-v-capita-2017-uksc-24#para-10',
    )
    expect(
      screen.getAllByText(/The National Archives \(Find Case Law\)/).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/judgment \[10\]/).length).toBeGreaterThan(0)
  })

  it('counts the filters apart and shows only the state chosen', async () => {
    await renderVerify()
    fireEvent.click(await screen.findByRole('tab', { name: /Needs review/ }))
    await waitFor(() => {
      expect(screen.queryByText('Citation matches checked source')).toBeNull()
    })
    // The status word appears on the row, not only in the selected filter.
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0)
    expect(
      screen.queryByText('Flagged', { selector: '[class*="text-meta"]' }),
    ).toBeNull()
  })

  it('records a dismissal with a reason and shows who decided and when', async () => {
    await renderVerify()
    const buttons = await screen.findAllByRole('button', {
      name: 'Dismiss finding',
    })
    fireEvent.click(buttons[0]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(dialog.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'The paragraph quotes the judgment directly.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss finding', hidden: false }),
    )
    await waitFor(() => expect(dismissals).toEqual(['vf_flagged']))
    expect(
      await screen.findByText(/Dismissed by you · 26 Oct 2026, 09:02/),
    ).toBeTruthy()
    expect(
      screen.getByText('The paragraph quotes the judgment directly.'),
    ).toBeTruthy()
    // The check's own outcome is unchanged: it is still a flagged finding.
    expect(screen.getAllByText('Flagged').length).toBeGreaterThan(0)
  })

  it('renders a dismissed finding as settled and reopens it on request', async () => {
    findings = [
      {
        ...flagged,
        dismissal: {
          reason: 'The paragraph quotes the judgment directly.',
          dismissedBy: 'usr_2',
          dismissedByName: 'Priya Shah',
          dismissedAt: '2026-10-26T09:02:00.000Z',
        },
      },
      finding(),
    ]
    await renderVerify()
    // Settled, not alarming: the state word is the decision, not the outcome.
    expect(await screen.findByText('Dismissed')).toBeTruthy()
    // The tab still counts the run's outcomes; the card no longer states one.
    expect(screen.queryByText('Flagged', { selector: 'span' })).toBeNull()
    expect(screen.getByText(/Dismissed by Priya Shah ·/)).toBeTruthy()
    expect(
      screen.getByText('The paragraph quotes the judgment directly.'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen finding' }))
    await waitFor(() => expect(reopenals).toEqual(['vf_flagged']))
    // Back in the queue: the finding shows its own state again.
    await waitFor(() => expect(screen.queryByText('Dismissed')).toBeNull())
    expect(
      screen.getAllByText('Flagged', { selector: 'span' }).length,
    ).toBeGreaterThan(0)
  })

  it('says a dismissal was not saved and keeps the finding open when it fails', async () => {
    dismissFails = true
    await renderVerify()
    const buttons = await screen.findAllByRole('button', {
      name: 'Dismiss finding',
    })
    fireEvent.click(buttons[0]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Dismiss finding' }),
    )
    expect(
      await within(dialog).findByText(/The dismissal was not saved\./),
    ).toBeTruthy()
    // Nothing is recorded, so the finding is still undismissed.
    expect(dismissals).toEqual([])
    expect(screen.queryByText(/Dismissed by you/)).toBeNull()
  })

  it('states a failed run, why it stopped, and offers a retry', async () => {
    runs = [
      run({
        status: 'failed',
        failureCode: 'execution_failed',
        summary: {
          findingCount: 0,
          flaggedCount: 0,
          reviewRequiredCount: 0,
          notCheckedCount: 0,
          dismissedCount: 0,
        },
      }),
    ]
    findings = []
    await renderVerify()
    expect(
      await screen.findByText('The run stopped before it finished'),
    ).toBeTruthy()
    expect(screen.getByText(/No successful result was recorded/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry Verify' })).toBeTruthy()
  })

  it('states a queued run without claiming anything was checked', async () => {
    runs = [run({ status: 'queued', startedAt: null, completedAt: null })]
    findings = []
    await renderVerify()
    expect(
      await screen.findByText('Queued. Nothing has been checked yet.'),
    ).toBeTruthy()
  })

  it('names the earlier completed result when the newest run failed', async () => {
    runs = [
      run({
        id: 'vrun_failed',
        status: 'failed',
        failureCode: 'model_unavailable',
        completedAt: at,
      }),
      run({ id: 'vrun_done', completedAt: '2026-10-26T08:00:00.000Z' }),
    ]
    await renderVerify()
    expect(
      await screen.findByText(
        /The findings below come from the earlier completed run/,
      ),
    ).toBeTruthy()
  })

  it('offers the matter route when there is nothing to verify yet', async () => {
    runs = []
    await renderVerify()
    expect(await screen.findByText('No verification runs yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open matters' })).toBeTruthy()
  })
})
