import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RedactionRunsRegion } from './runs-region'

const query = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: query.useQuery }))

const shell = vi.hoisted(() => ({ useDocument: vi.fn() }))
vi.mock('@obiter/app-shell', () => ({
  apiFetch: vi.fn(),
  useDocument: shell.useDocument,
}))

const hooks = vi.hoisted(() => ({
  useCreateDocumentRedactionRun: vi.fn(),
}))
vi.mock('./hooks', () => hooks)

describe('RedactionRunsRegion', () => {
  it('marks only degraded document runs', () => {
    shell.useDocument.mockReturnValue({
      isPending: false,
      data: { document: { currentVersion: { documentStatus: 'ready' } } },
    })
    hooks.useCreateDocumentRedactionRun.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    })
    query.useQuery.mockReturnValue({
      isPending: false,
      data: {
        runs: [
          {
            id: 'red_degraded',
            status: 'ready_for_review',
            detectionMode: 'heuristics+supplement',
            replacementRunId: 'red_model',
            summary: { totalSpans: 0, reviewedCount: 0 },
          },
          {
            id: 'red_unknown',
            status: 'ready_for_review',
            detectionMode: 'unknown',
            summary: { totalSpans: 0, reviewedCount: 0 },
          },
          {
            id: 'red_model',
            status: 'ready_for_review',
            detectionMode: 'model+supplement',
            replacesRunId: 'red_degraded',
            summary: { totalSpans: 1, reviewedCount: 1 },
          },
        ],
      },
    })

    render(<RedactionRunsRegion documentId="doc_1" onOpenRun={vi.fn()} />)

    expect(screen.getByText('red_degraded')).toBeTruthy()
    expect(screen.getByText('red_unknown')).toBeTruthy()
    expect(screen.getByText('red_model')).toBeTruthy()
    expect(screen.getAllByText('Degraded detection')).toHaveLength(1)
    expect(screen.getAllByText('Detection mode unknown')).toHaveLength(1)
    expect(screen.getByText('Replaced')).toBeTruthy()
    expect(screen.getByText('Re-detection')).toBeTruthy()
  })
})
