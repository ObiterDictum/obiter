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
})
