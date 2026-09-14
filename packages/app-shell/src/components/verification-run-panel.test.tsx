// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VerificationRunPanel } from './verification-run-panel'
import { ApiError } from '../api'
import type { VerificationRun } from '@obiter/contracts'

const documentHook = vi.hoisted(() => ({ useDocument: vi.fn() }))
const runsHook = vi.hoisted(() => ({
  useDocumentVerificationRuns: vi.fn(),
  useCreateVerificationRun: vi.fn(),
  useVerificationFindings: vi.fn(),
  latestVerificationRun: vi.fn(),
}))

vi.mock('../documents', () => ({
  useDocument: documentHook.useDocument,
}))

vi.mock('../verification-runs', () => ({
  useDocumentVerificationRuns: runsHook.useDocumentVerificationRuns,
  useCreateVerificationRun: runsHook.useCreateVerificationRun,
  useVerificationFindings: runsHook.useVerificationFindings,
  latestVerificationRun: runsHook.latestVerificationRun,
}))

const draftHook = vi.hoisted(() => ({ useDocumentDraftStatus: vi.fn() }))
vi.mock('./document-workspace/document-draft-status', () => ({
  useDocumentDraftStatus: draftHook.useDocumentDraftStatus,
}))

function run(overrides: Partial<VerificationRun> = {}): VerificationRun {
  return {
    id: 'vrun_1',
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
    summary: { findingCount: 1, flaggedCount: 0, reviewRequiredCount: 1 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function readyDocument() {
  return {
    isPending: false,
    isError: false,
    data: {
      document: {
        currentVersion: { id: 'ver_1', documentStatus: 'ready' },
      },
    },
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  draftHook.useDocumentDraftStatus.mockReturnValue(null)
})

describe('VerificationRunPanel', () => {
  it('shows not started, running, review-required, failed, stale, and permission loss', () => {
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })

    documentHook.useDocument.mockReturnValue(readyDocument())
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [] },
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    const { rerender } = render(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText(/Verification has not been started/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Run verification' }),
    ).toBeTruthy()

    const running = run({
      status: 'running',
      completedAt: null,
      summary: {
        findingCount: 0,
        flaggedCount: 0,
        reviewRequiredCount: 0,
      },
    })
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [running] },
    })
    runsHook.latestVerificationRun.mockReturnValue(running)
    rerender(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText(/Verification is running/)).toBeTruthy()

    const review = run()
    runsHook.latestVerificationRun.mockReturnValue(review)
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [review] },
    })
    rerender(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText('Review required (1)')).toBeTruthy()

    const failed = run({
      status: 'failed',
      failureCode: 'execution_failed',
      summary: { findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0 },
    })
    runsHook.latestVerificationRun.mockReturnValue(failed)
    rerender(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByRole('status').textContent).toContain('Failed')

    const stale = run({ stale: true, documentCurrentVersionId: 'ver_2' })
    runsHook.latestVerificationRun.mockReturnValue(stale)
    rerender(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText('Earlier version')).toBeTruthy()

    documentHook.useDocument.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    })
    rerender(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText('Verification is unavailable')).toBeTruthy()
  })

  it('renders a loading skeleton while the document is pending', () => {
    documentHook.useDocument.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    })
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    const { container } = render(<VerificationRunPanel documentId="doc_1" />)
    expect(container.querySelector('.h-24')).toBeTruthy()
  })

  it('surfaces a run-list failure rather than an empty state', () => {
    documentHook.useDocument.mockReturnValue(readyDocument())
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('verification runs are unavailable'),
      data: undefined,
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    render(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText('Verification runs are unavailable')).toBeTruthy()
    expect(screen.getByText('verification runs are unavailable')).toBeTruthy()
  })

  it('explains a denied start without the raw error message', () => {
    documentHook.useDocument.mockReturnValue(readyDocument())
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [] },
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: new ApiError('forbidden', 'forbidden', 403, 'req_1'),
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    render(<VerificationRunPanel documentId="doc_1" />)
    expect(
      screen.getByText(
        'You do not have permission to start verification on this document.',
      ),
    ).toBeTruthy()
  })

  it('moves focus to the live status region after a start settles', () => {
    const mutate = vi.fn(
      (_versionId: string, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      },
    )
    documentHook.useDocument.mockReturnValue(readyDocument())
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [] },
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate,
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    render(<VerificationRunPanel documentId="doc_1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Run verification' }))
    expect(document.activeElement).toBe(screen.getByRole('status'))
  })

  it('shows a flagged completion as attention required, not a plain success', () => {
    documentHook.useDocument.mockReturnValue(readyDocument())
    const flagged = run({
      summary: { findingCount: 3, flaggedCount: 2, reviewRequiredCount: 1 },
    })
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [flagged] },
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(flagged)
    render(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText('Flagged findings (2)')).toBeTruthy()
    expect(
      screen.getByText('Attention required: flagged findings were found.'),
    ).toBeTruthy()
    // The status region announces the outcome too.
    expect(screen.getByRole('status').textContent).toContain('flagged findings')
  })

  it('gates the run action while the editor has unsaved work', () => {
    documentHook.useDocument.mockReturnValue(readyDocument())
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [] },
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    draftHook.useDocumentDraftStatus.mockReturnValue({ dirty: true })
    render(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Run verification',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('discloses that an active run excludes newer unsaved edits', () => {
    documentHook.useDocument.mockReturnValue(readyDocument())
    const running = run({
      status: 'running',
      completedAt: null,
      summary: { findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0 },
    })
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [running] },
    })
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    })
    runsHook.useVerificationFindings.mockReturnValue({
      isPending: false,
      isError: false,
      findings: [],
    })
    runsHook.latestVerificationRun.mockReturnValue(running)
    draftHook.useDocumentDraftStatus.mockReturnValue({ dirty: true })
    render(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByRole('status').textContent).toContain(
      'Unsaved editor changes',
    )
  })
})
