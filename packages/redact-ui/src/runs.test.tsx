import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RedactionRunsView } from './runs'

const hooks = vi.hoisted(() => ({
  useRedactionRuns: vi.fn(),
  useCreateRedactionRun: vi.fn(),
  useCreateUploadedRedactionRun: vi.fn(),
  useDeleteRedactionRun: vi.fn(),
}))

vi.mock('./hooks', () => hooks)

const ui = vi.hoisted(() => ({ useToast: vi.fn() }))
vi.mock('@obiter/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@obiter/ui')>()
  return { ...actual, useToast: ui.useToast }
})

const shell = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
vi.mock('@obiter/app-shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@obiter/app-shell')>()
  return { ...actual, useCurrentUser: shell.useCurrentUser }
})

describe('RedactionRunsView', () => {
  it('keeps pasted text as the standalone default and accepts DOCX, PDF, and TXT uploads', () => {
    hooks.useRedactionRuns.mockReturnValue({
      isPending: false,
      data: { runs: [] },
    })
    hooks.useCreateRedactionRun.mockReturnValue({ mutate: vi.fn() })
    hooks.useCreateUploadedRedactionRun.mockReturnValue({ mutate: vi.fn() })
    hooks.useDeleteRedactionRun.mockReturnValue({ mutateAsync: vi.fn() })
    ui.useToast.mockReturnValue({ toast: vi.fn() })
    shell.useCurrentUser.mockReturnValue({
      data: {
        user: {
          id: 'usr_1',
          email: 'lex@obiter.dev',
          name: 'Lex',
          role: 'owner',
        },
      },
    })

    render(<RedactionRunsView onOpenRun={vi.fn()} />)

    expect(screen.getByLabelText('Document text')).toBeTruthy()
    const upload = screen.getByLabelText('Or upload a document')
    expect(upload).toHaveProperty('accept', expect.stringContaining('.docx'))
    expect(upload).toHaveProperty('accept', expect.stringContaining('.txt'))
    expect(upload).toHaveProperty('accept', expect.stringContaining('.pdf'))
    expect(screen.getByText(/text-layer PDF/)).toBeTruthy()
    expect(screen.getByText(/up to 25 MB/)).toBeTruthy()
  })

  it('distinguishes degraded and unknown runs without labelling model-detected runs', () => {
    hooks.useRedactionRuns.mockReturnValue({
      isPending: false,
      data: {
        runs: [
          {
            id: 'red_degraded',
            sourceFilename: 'degraded.txt',
            matterId: null,
            status: 'ready_for_review',
            detectionMode: 'heuristics+supplement',
            replacementRunId: 'red_model',
            createdAt: '2026-07-09T00:00:00.000Z',
          },
          {
            id: 'red_unknown',
            sourceFilename: 'unknown.txt',
            matterId: null,
            status: 'ready_for_review',
            detectionMode: 'unknown',
            createdAt: '2026-07-09T00:00:00.000Z',
          },
          {
            id: 'red_model',
            sourceFilename: 'model.txt',
            matterId: null,
            status: 'ready_for_review',
            detectionMode: 'model+supplement',
            replacesRunId: 'red_degraded',
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        ],
      },
    })
    hooks.useCreateRedactionRun.mockReturnValue({ mutate: vi.fn() })
    hooks.useCreateUploadedRedactionRun.mockReturnValue({ mutate: vi.fn() })
    hooks.useDeleteRedactionRun.mockReturnValue({ mutateAsync: vi.fn() })
    ui.useToast.mockReturnValue({ toast: vi.fn() })
    shell.useCurrentUser.mockReturnValue({
      data: {
        user: {
          id: 'usr_1',
          email: 'lex@obiter.dev',
          name: 'Lex',
          role: 'member',
        },
      },
    })

    render(<RedactionRunsView onOpenRun={vi.fn()} />)

    expect(screen.getByText('degraded.txt')).toBeTruthy()
    expect(screen.getByText('unknown.txt')).toBeTruthy()
    expect(screen.getByText('model.txt')).toBeTruthy()
    expect(screen.getAllByText('Degraded detection')).toHaveLength(1)
    expect(screen.getAllByText('Detection mode unknown')).toHaveLength(1)
    expect(screen.getByText('Replaced')).toBeTruthy()
    expect(screen.getByText('Re-detection')).toBeTruthy()
  })
})
