// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VerificationRunPanel } from './verification-run-panel'
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
      data: { findings: [] },
    })

    documentHook.useDocument.mockReturnValue(readyDocument())
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [] },
    })
    runsHook.latestVerificationRun.mockReturnValue(null)
    const { rerender } = render(<VerificationRunPanel documentId="doc_1" />)
    expect(
      screen.getByText(/Verification has not been started/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeTruthy()

    const running = run({ status: 'running', completedAt: null, summary: {
      findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0,
    } })
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
    expect(screen.getByText('Completed with review required')).toBeTruthy()

    const failed = run({
      status: 'failed',
      failureCode: 'execution_failed',
      summary: { findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0 },
    })
    runsHook.latestVerificationRun.mockReturnValue(failed)
    rerender(<VerificationRunPanel documentId="doc_1" />)
    expect(screen.getByRole('status').textContent).toBe('Failed')

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
})
