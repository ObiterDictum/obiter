import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const query = vi.hoisted(() => ({ useQuery: vi.fn() }))
const tanstackReactQueryKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-query')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-query', () =>
  Object.assign({ ...tanstackReactQueryKeys }, { useQuery: query.useQuery }),
)

const shell = vi.hoisted(() => ({ useDocument: vi.fn() }))
const obiterAppShellKeys = Object.fromEntries(
  Object.keys(await import('@obiter/app-shell')).map((key) => [key, undefined]),
)
mock.module('@obiter/app-shell', () =>
  Object.assign(
    { ...obiterAppShellKeys },
    { apiFetch: vi.fn(), useDocument: shell.useDocument },
  ),
)

const hooks = vi.hoisted(() => ({
  useCreateDocumentRedactionRun: vi.fn(),
}))
const hooksKeys = Object.fromEntries(
  Object.keys(await import('./hooks')).map((key) => [key, undefined]),
)
mock.module('./hooks', () => Object.assign({ ...hooksKeys }, hooks))

const { RedactionRunsRegion } = await import('./runs-region')

function run(overrides: Record<string, unknown>) {
  return {
    id: 'red_1',
    status: 'ready_for_review',
    createdAt: '2026-10-26T14:00:00.000Z',
    summary: { totalSpans: 4, reviewedCount: 1 },
    ...overrides,
  }
}

beforeEach(() => {
  shell.useDocument.mockReturnValue({
    isPending: false,
    data: { document: { currentVersion: { documentStatus: 'ready' } } },
  })
  hooks.useCreateDocumentRedactionRun.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  })
})

describe('RedactionRunsRegion', () => {
  it('describes each run by state and decided count, never by its id', () => {
    query.useQuery.mockReturnValue({
      isPending: false,
      data: {
        runs: [
          run({ id: 'red_8e990bd2-d3cb-4229-8d1c-eec48157d43c' }),
          run({ id: 'red_done', status: 'finalized' }),
        ],
      },
    })

    render(<RedactionRunsRegion documentId="doc_1" onOpenRun={vi.fn()} />)

    expect(screen.getByText('Ready for review')).toBeTruthy()
    expect(screen.getByText('Finalised')).toBeTruthy()
    expect(screen.getAllByText('1 of 4 decided')).toHaveLength(2)
    // Raw ids must never appear in the product.
    expect(screen.queryByText(/red_8e990bd2/u)).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
  })

  it('states why a run failed', () => {
    query.useQuery.mockReturnValue({
      isPending: false,
      data: {
        runs: [
          run({
            sourceFilename: 'witness-statement.docx',
            sourceMimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 'failed',
            summary: {
              totalSpans: 0,
              reviewedCount: 0,
              // A reason recorded by a PDF run must not be shown for a .docx.
              failureReason: 'No text layer was found in this PDF.',
            },
          }),
        ],
      },
    })
    render(<RedactionRunsRegion documentId="doc_1" onOpenRun={vi.fn()} />)
    expect(screen.getByText(/could not read this Word document/u)).toBeTruthy()
    expect(screen.queryByText(/text layer/iu)).toBeNull()
  })

  it('cannot start a run until text extraction has finished', () => {
    shell.useDocument.mockReturnValue({
      isPending: false,
      data: {
        document: {
          currentVersion: {
            documentStatus: 'failed',
            failureReason: 'Text extraction failed.',
          },
        },
      },
    })
    query.useQuery.mockReturnValue({ isPending: false, data: { runs: [] } })
    render(<RedactionRunsRegion documentId="doc_1" onOpenRun={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Redact this document' }),
    ).toHaveProperty('disabled', true)
    expect(screen.getByText('Text extraction failed.')).toBeTruthy()
  })
})
