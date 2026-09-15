// @vitest-environment jsdom
// Pagination truthfulness through the real infinite query. The provider's
// findings hook is NOT mocked here: `apiFetch` is the external-network
// boundary, and the run's second findings page is only reachable if the
// provider really walks the cursor. A preassembled findings array could not
// expose the defect this file pins (totals, coverage and navigation bounded by
// the loaded page).
import { createElement, type PropsWithChildren } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import { VerificationWorkspaceProvider } from '../verification/verification-context'
import { VerificationDock } from '../verification/verification-dock'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, apiFetch: api.apiFetch }
})

const documentHook = vi.hoisted(() => ({ useDocument: vi.fn() }))
vi.mock('../../documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../documents')>()
  return { ...actual, useDocument: documentHook.useDocument }
})

const modelHook = vi.hoisted(() => ({ useDocumentModel: vi.fn() }))
vi.mock('../../document-workspace-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-workspace-api')>()
  return { ...actual, useDocumentModel: modelHook.useDocumentModel }
})

const RUN_ID = 'vrun_1'

function finding(
  index: number,
  overrides: Partial<VerificationFindingView> = {},
) {
  return {
    id: `vf_${index}`,
    type: 'citation_resolution' as const,
    state: 'clear' as const,
    reviewReason: null,
    severity: 'low' as const,
    confidence: 'high' as const,
    requiresReview: false,
    explanation: `Explanation ${index}`,
    excerpt: `[2012] UKSC ${index}`,
    location: {
      paragraphId: `p${index}`,
      storyKind: 'document' as const,
      storyPartName: 'word/document.xml',
      start: 0,
      end: 4,
    },
    authorityLabel: `Authority ${index}`,
    evidence: [],
    ...overrides,
  } satisfies VerificationFindingView
}

const pageOne = Array.from({ length: 50 }, (_, i) => finding(i + 1))
const pageTwo = [
  finding(51, {
    explanation: 'Page two explanation',
    authorityLabel: 'Page two authority',
  }),
  finding(52, { state: 'flagged', authorityLabel: 'Page two flagged one' }),
  finding(53, { state: 'flagged', authorityLabel: 'Page two flagged two' }),
  finding(54),
  finding(55),
]

function run(): VerificationRun {
  return {
    id: RUN_ID,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-09-14T00:00:00.000Z',
    startedAt: '2026-09-14T00:00:01.000Z',
    completedAt: '2026-09-14T00:00:02.000Z',
    summary: { findingCount: 55, flaggedCount: 2, reviewRequiredCount: 0 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
  }
}

function pageFor(url: string) {
  if (url.includes('/verification-runs') && !url.includes('/findings')) {
    return { runs: [run()] }
  }
  if (url.includes('/findings')) {
    if (url.includes('cursor=page-2')) {
      return { run: run(), findings: pageTwo, nextCursor: null }
    }
    return { run: run(), findings: pageOne, nextCursor: 'page-2' }
  }
  throw new Error(`unexpected apiFetch url: ${url}`)
}

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

documentHook.useDocument.mockReturnValue({
  isPending: false,
  isError: false,
  data: {
    document: { currentVersion: { id: 'ver_1', documentStatus: 'ready' } },
  },
})
modelHook.useDocumentModel.mockReturnValue({ data: null })

function mount() {
  api.apiFetch.mockImplementation((url: string) =>
    Promise.resolve(pageFor(url)),
  )
  return render(
    <VerificationWorkspaceProvider documentId="doc_1" mappable={false}>
      <VerificationDock />
    </VerificationWorkspaceProvider>,
    { wrapper },
  )
}

describe('contextual verification pagination', () => {
  it('walks the findings cursor so coverage and totals are the whole run', async () => {
    mount()
    // The second page is only fetched through the real infinite-query cursor.
    await waitFor(() => {
      expect(
        api.apiFetch.mock.calls.some(([url]) =>
          String(url).includes('cursor=page-2'),
        ),
      ).toBe(true)
    })
    const dock = await screen.findByRole('region', { name: 'Verification' })
    // Counts come from the run summary over every finding, not page one.
    await waitFor(() => {
      expect(dock.textContent).toContain('2 flagged')
    })
    expect(dock.textContent).toContain('53 clear')
    expect(dock.textContent).toContain('0 needs review')
  })

  it('makes a finding past the first page reachable and reports the run total', async () => {
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: 'View all findings' }),
    )
    const index = await screen.findByRole('dialog')
    // The row for a second-page finding is present and activatable.
    await waitFor(() => {
      expect(index.textContent).toContain('Page two explanation')
    })
    fireEvent.click(screen.getByText('Page two explanation'))
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('Page two authority')
    // "51 of 55": the position uses the server total, not the loaded subset.
    expect(panel.textContent).toContain('51 of 55')
  })
})
