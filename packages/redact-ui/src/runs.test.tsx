import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RedactionRunsView } from './runs'

const hooks = vi.hoisted(() => ({
  useRedactionRuns: vi.fn(),
  useCreateRedactionRun: vi.fn(),
  useCreateUploadedRedactionRun: vi.fn(),
}))

vi.mock('./hooks', () => hooks)

describe('RedactionRunsView', () => {
  it('keeps pasted text as the standalone default and accepts DOCX/TXT uploads', () => {
    hooks.useRedactionRuns.mockReturnValue({
      isPending: false,
      data: { runs: [] },
    })
    hooks.useCreateRedactionRun.mockReturnValue({ mutate: vi.fn() })
    hooks.useCreateUploadedRedactionRun.mockReturnValue({ mutate: vi.fn() })

    render(<RedactionRunsView onOpenRun={vi.fn()} />)

    expect(screen.getByLabelText('Document text')).toBeTruthy()
    const upload = screen.getByLabelText('Or upload a document')
    expect(upload).toHaveProperty('accept', expect.stringContaining('.docx'))
    expect(upload).toHaveProperty('accept', expect.stringContaining('.txt'))
    expect(screen.getByText(/up to 25 MB/)).toBeTruthy()
  })
})
