import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const hooks = vi.hoisted(() => ({
  useRedactionRuns: vi.fn(),
  useCreateRedactionRun: vi.fn(),
  useCreateUploadedRedactionRun: vi.fn(),
  useDeleteRedactionRun: vi.fn(),
}))

const hooksModuleKeys = Object.fromEntries(
  Object.keys(await import('./hooks')).map((key) => [key, undefined]),
)
mock.module('./hooks', () =>
  Object.assign({ ...hooksModuleKeys }, (() => hooks)()),
)

const ui = vi.hoisted(() => ({ useToast: vi.fn() }))
const obiterUiModule = { ...(await import('@obiter/ui')) }
const obiterUiModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/ui')).map((key) => [key, undefined]),
)
mock.module('@obiter/ui', () =>
  Object.assign(
    { ...obiterUiModuleKeys },
    (() => ({ ...obiterUiModule, useToast: ui.useToast }))(),
  ),
)

const shell = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
const obiterAppShellModule = { ...(await import('@obiter/app-shell')) }
const obiterAppShellModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/app-shell')).map((key) => [key, undefined]),
)
mock.module('@obiter/app-shell', () =>
  Object.assign(
    { ...obiterAppShellModuleKeys },
    (() => ({
      ...obiterAppShellModule,
      useCurrentUser: shell.useCurrentUser,
    }))(),
  ),
)

const { RedactionRunsView } = await import('./runs')

function run(overrides: Record<string, unknown>) {
  return {
    id: 'red_1',
    sourceFilename: 'statement.pdf',
    matterId: null,
    matterName: null,
    status: 'ready_for_review',
    detectionMode: 'model+supplement',
    replacesRunId: null,
    replacementRunId: null,
    returnedDocumentVersionId: null,
    createdAt: '2026-10-26T14:00:00.000Z',
    summary: { totalSpans: 21, reviewedCount: 18 },
    ...overrides,
  }
}

beforeEach(() => {
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
      organisation: { id: 'org_1', name: 'Obiter Legal', plan: 'private_beta' },
    },
  })
})

describe('RedactionRunsView', () => {
  it('leads with the upload and keeps pasted text as an alternative', () => {
    render(<RedactionRunsView onOpenRun={vi.fn()} />)

    const upload = screen.getByLabelText('Upload a document to redact')
    expect(upload).toHaveProperty('accept', expect.stringContaining('.docx'))
    expect(upload).toHaveProperty('accept', expect.stringContaining('.txt'))
    expect(upload).toHaveProperty('accept', expect.stringContaining('.pdf'))
    expect(screen.getByText('Drop the document here')).toBeTruthy()
    expect(screen.getByText(/Up to 25 MB/u)).toBeTruthy()
    expect(screen.getByText(/The original is never changed/u)).toBeTruthy()
    // Pasted text is behind a disclosure, and says what it costs.
    expect(screen.queryByLabelText('Document text')).toBeNull()
    expect(screen.getByText(/For a short extract/u)).toBeTruthy()
    // A secondary action, not a heading: the upload stays the primary path.
    const paste = screen.getByRole('button', { name: 'Paste text instead' })
    expect(paste.className).not.toContain('ghost')
    fireEvent.click(paste)
    expect(screen.getByLabelText('Document text')).toBeTruthy()
  })

  it('keeps delete behind a menu and a confirmation, away from Continue', () => {
    const mutateAsync = vi.fn()
    hooks.useDeleteRedactionRun.mockReturnValue({ mutateAsync })
    hooks.useRedactionRuns.mockReturnValue({
      isPending: false,
      data: { runs: [run({ status: 'reviewing' })] },
    })
    render(<RedactionRunsView onOpenRun={vi.fn()} />)
    // The row's neighbour of Continue is not a destructive control.
    expect(
      screen.queryByRole('button', { name: /^Delete run for/u }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'More actions for statement.pdf',
      }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete run/u }))
    expect(screen.getByText('Delete redaction run')).toBeTruthy()
    expect(screen.getByText(/Removals are soft/u)).toBeTruthy()
    // Nothing is deleted until the dialog is confirmed.
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('reports an upload that failed instead of pretending a run started', () => {
    hooks.useCreateUploadedRedactionRun.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new Error('Only DOCX, PDF and text files are supported.'),
    })
    render(<RedactionRunsView onOpenRun={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain(
      'The document was not uploaded, so no run was started.',
    )
  })

  it('states what each run is doing, what is undecided and why a run failed', () => {
    hooks.useRedactionRuns.mockReturnValue({
      isPending: false,
      data: {
        runs: [
          run({ id: 'red_reviewing', status: 'reviewing' }),
          run({
            id: 'red_failed',
            sourceFilename: 'scan.pdf',
            status: 'failed',
            summary: {
              totalSpans: 0,
              reviewedCount: 0,
              failureReason: 'No text layer was found in this PDF.',
            },
          }),
          run({
            id: 'red_done',
            sourceFilename: 'bundle.pdf',
            status: 'finalized',
          }),
        ],
      },
    })
    render(<RedactionRunsView onOpenRun={vi.fn()} />)

    expect(screen.getByText('In review')).toBeTruthy()
    expect(screen.getByText('Finalised')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getAllByText('18 of 21 decided')).toHaveLength(2)
    expect(
      screen.getByText('No text layer was found in this PDF.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    // No run calls itself a "standalone run".
    expect(screen.queryByText(/Standalone run/u)).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy()
  })
})
