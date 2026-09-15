// @vitest-environment jsdom
// Cached-document continuation failure, through the real infinite query. A
// document that was opened before has its findings pages in the query cache; a
// continuation (or a refetch of pages already loaded) that fails must be
// disclosed, must not hide the findings that did load, and must be retryable
// without duplicating findings, losing the selection, or reloading the page.
//
// The provider's findings hook is NOT mocked here: `apiFetch` is the only
// network boundary, so only the real keyset walk and the real query cache are
// under test.
import { createElement, type PropsWithChildren } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  VerificationFindingView,
  VerificationFindingsResponse,
  VerificationRun,
  VerificationRunListResponse,
} from '@obiter/contracts'
import { verificationFindingsQueryKey } from '../../verification-runs'
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
): VerificationFindingView {
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
  }
}

const pageOne = [finding(1), finding(2)]
const pageTwo = [finding(3), finding(4)]

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
    summary: { findingCount: 4, flaggedCount: 0, reviewRequiredCount: 0 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
  }
}

/** The mutable network boundary: the same URL can succeed, then fail, then
 * recover, exactly as a flaky continuation does in the browser. */
const network = {
  failContinuation: true,
  failFirstPage: false,
  calls: [] as string[],
}

function pageFor(
  url: string,
): Promise<VerificationFindingsResponse | VerificationRunListResponse> {
  network.calls.push(url)
  if (url.includes('/verification-runs') && !url.includes('/findings')) {
    return Promise.resolve({ runs: [run()], nextCursor: null })
  }
  if (url.includes('cursor=page-2')) {
    // A continuation failure is a rejected network boundary and must be
    // disclosed rather than silently leaving the loaded pages as the run.
    return network.failContinuation
      ? Promise.reject(new Error('the continuation request failed'))
      : Promise.resolve({ run: run(), findings: pageTwo, nextCursor: null })
  }
  if (network.failFirstPage) {
    return Promise.reject(new Error('the findings request failed'))
  }
  return Promise.resolve({
    run: run(),
    findings: pageOne,
    nextCursor: 'page-2',
  })
}

function newClient(refetchOnMount: boolean) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount,
        staleTime: refetchOnMount ? 0 : Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

function seedPartialCache(client: QueryClient) {
  client.setQueryData(verificationFindingsQueryKey(RUN_ID), {
    pages: [{ run: run(), findings: pageOne, nextCursor: 'page-2' }],
    pageParams: [null],
  })
}

function seedCompleteCache(client: QueryClient) {
  client.setQueryData(verificationFindingsQueryKey(RUN_ID), {
    pages: [
      { run: run(), findings: pageOne, nextCursor: 'page-2' },
      { run: run(), findings: pageTwo, nextCursor: null },
    ],
    pageParams: [null, 'page-2'],
  })
}

function wrapper(client: QueryClient) {
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)
}

function mount(client: QueryClient) {
  return render(
    <VerificationWorkspaceProvider documentId="doc_1" mappable={false}>
      <VerificationDock />
    </VerificationWorkspaceProvider>,
    { wrapper: wrapper(client) },
  )
}

function verificationRegion() {
  return screen.getByRole('region', { name: 'Verification' })
}

async function waitForContinuationFailure() {
  await waitFor(() => {
    expect(
      within(verificationRegion()).getByRole('alert').textContent,
    ).toContain('the continuation request failed')
  })
}

beforeEach(() => {
  network.failContinuation = true
  network.failFirstPage = false
  network.calls = []
  api.apiFetch.mockImplementation((url: string) => pageFor(String(url)))
  documentHook.useDocument.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      document: { currentVersion: { id: 'ver_1', documentStatus: 'ready' } },
    },
  })
  modelHook.useDocumentModel.mockReturnValue({ data: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('cached-document findings failure', () => {
  it('discloses a cached continuation failure, keeps the loaded findings, and retries to the whole run', async () => {
    const client = newClient(false)
    seedPartialCache(client)
    mount(client)

    // The failure is disclosed even though page one is already cached, and the
    // retry is a real, named control rather than only a "Load more".
    await waitForContinuationFailure()
    const region = verificationRegion()
    // The server-computed total is still shown; the summary is not derived from
    // the loaded page.
    expect(region.textContent).toContain('4 clear')

    fireEvent.click(
      within(region).getByRole('button', { name: 'View all findings' }),
    )
    const dialog = await screen.findByRole('dialog')
    // Retry lives in the surface that lists findings, next to the failure.
    const retry = within(dialog).getByRole('button', { name: /retry/i })
    // The findings that did load are preserved rather than replaced by the
    // error, and the run is not presented as complete.
    expect(within(dialog).getByText('Explanation 1')).toBeTruthy()
    expect(within(dialog).getByText('Explanation 2')).toBeTruthy()
    expect(dialog.textContent).not.toContain('found nothing to list')

    // Recovery: the same query appends the missing page.
    network.failContinuation = false
    fireEvent.click(retry)
    await waitFor(() => {
      expect(within(dialog).getByText('Explanation 3')).toBeTruthy()
    })
    expect(within(dialog).getByText('Explanation 4')).toBeTruthy()
    // No duplicates and the counts are stable.
    expect(within(dialog).getAllByText('Explanation 1')).toHaveLength(1)
    expect(within(dialog).getAllByText('Explanation 4')).toHaveLength(1)
    expect(within(dialog).queryByRole('alert')).toBeNull()
    // The continuation was retried with the same cursor, not restarted from
    // the first page.
    expect(
      network.calls.filter((url) => url.includes('cursor=page-2')),
    ).toHaveLength(2)
  })

  it('keeps the selected finding through a failed continuation and its retry', async () => {
    const client = newClient(false)
    seedPartialCache(client)
    mount(client)
    await waitForContinuationFailure()

    fireEvent.click(
      within(verificationRegion()).getByRole('button', {
        name: 'View all findings',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Explanation 1'))
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('Authority 1')

    network.failContinuation = false
    fireEvent.click(
      within(verificationRegion()).getByRole('button', { name: /retry/i }),
    )
    await waitFor(() => {
      expect(within(verificationRegion()).queryByRole('alert')).toBeNull()
    })
    // Selection survives the recovery; the panel is not closed or retargeted.
    expect(panel.textContent).toContain('Authority 1')
    expect(panel.textContent).toContain('1 of 4')
  })

  it('discloses a failed refetch of an already-loaded cached run and retries it', async () => {
    const client = newClient(true)
    seedCompleteCache(client)
    mount(client)

    // The mount refetch of the cached pages fails on the continuation.
    await waitForContinuationFailure()
    const region = verificationRegion()
    expect(within(region).getByRole('button', { name: /retry/i })).toBeTruthy()

    fireEvent.click(
      within(region).getByRole('button', { name: 'View all findings' }),
    )
    const dialog = await screen.findByRole('dialog')
    // Both cached pages are still listed while the refetch failure is shown.
    expect(within(dialog).getByText('Explanation 3')).toBeTruthy()

    network.failContinuation = false
    fireEvent.click(within(dialog).getByRole('button', { name: /retry/i }))
    await waitFor(() => {
      expect(within(dialog).queryByRole('alert')).toBeNull()
    })
    expect(within(dialog).getAllByText('Explanation 3')).toHaveLength(1)
    expect(within(dialog).getByText('Explanation 4')).toBeTruthy()
  })

  it('keeps fresh-document failure disclosure and retry intact', async () => {
    network.failFirstPage = true
    const client = newClient(false)
    mount(client)

    await waitFor(() => {
      expect(
        within(verificationRegion()).getByRole('alert').textContent,
      ).toContain('the findings request failed')
    })
    // Nothing loaded is never presented as a completed empty run.
    expect(verificationRegion().textContent).not.toContain(
      'found nothing to list',
    )

    network.failFirstPage = false
    network.failContinuation = false
    fireEvent.click(
      within(verificationRegion()).getByRole('button', { name: /retry/i }),
    )
    await waitFor(() => {
      expect(within(verificationRegion()).queryByRole('alert')).toBeNull()
    })
    fireEvent.click(
      within(verificationRegion()).getByRole('button', {
        name: 'View all findings',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByText('Explanation 1')).toBeTruthy()
    })
  })
})
