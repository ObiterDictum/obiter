import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const hooks = vi.hoisted(() => ({
  useRedactionRuns: vi.fn(),
  useCreateRedactionRun: vi.fn(),
  useCreateUploadedRedactionRun: vi.fn(),
  useDeleteRedactionRun: vi.fn(),
}))

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const hooksModuleKeys = Object.fromEntries(
  Object.keys(await import('./hooks')).map((key) => [key, undefined]),
)
mock.module('./hooks', () =>
  Object.assign({ ...hooksModuleKeys }, (() => hooks)()),
)

const ui = vi.hoisted(() => ({ useToast: vi.fn() }))
// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const obiterUiModule = { ...(await import('@obiter/ui')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const obiterUiModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/ui')).map((key) => [key, undefined]),
)
mock.module('@obiter/ui', () =>
  Object.assign(
    { ...obiterUiModuleKeys },
    (() => {
      const actual = obiterUiModule
      return { ...actual, useToast: ui.useToast }
    })(),
  ),
)

const shell = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const obiterAppShellModule = { ...(await import('@obiter/app-shell')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const obiterAppShellModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/app-shell')).map((key) => [key, undefined]),
)
mock.module('@obiter/app-shell', () =>
  Object.assign(
    { ...obiterAppShellModuleKeys },
    (() => {
      const actual = obiterAppShellModule
      return { ...actual, useCurrentUser: shell.useCurrentUser }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { RedactionRunsView } = await import('./runs')

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
        organisation: {
          id: 'org_1',
          name: 'Obiter Legal',
          plan: 'private_beta',
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
        organisation: {
          id: 'org_1',
          name: 'Obiter Legal',
          plan: 'private_beta',
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
