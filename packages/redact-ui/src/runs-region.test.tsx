import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const query = vi.hoisted(() => ({ useQuery: vi.fn() }))
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
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
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const obiterAppShellKeys = Object.fromEntries(
  Object.keys(await import('@obiter/app-shell')).map((key) => [key, undefined]),
)
mock.module('@obiter/app-shell', () =>
  Object.assign(
    { ...obiterAppShellKeys },
    {
      apiFetch: vi.fn(),
      useDocument: shell.useDocument,
    },
  ),
)

const hooks = vi.hoisted(() => ({
  useCreateDocumentRedactionRun: vi.fn(),
}))
// The real module's export names, available as undefined, so bun's
// static link check accepts imports the mock does not override.
const hooksKeys = Object.fromEntries(
  Object.keys(await import('./hooks')).map((key) => [key, undefined]),
)
mock.module('./hooks', () => Object.assign({ ...hooksKeys }, hooks))

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { RedactionRunsRegion } = await import('./runs-region')

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
