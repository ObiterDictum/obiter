import '@obiter/test-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import type { ReactNode } from 'react'
import type { VerificationRun } from '@obiter/contracts'

const hooks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useOrganisationVerificationRuns: vi.fn(),
  useVerificationRunDocuments: vi.fn(),
  useMattersList: vi.fn(),
}))

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const currentUserModuleKeys = Object.fromEntries(
  Object.keys(await import('../current-user')).map((key) => [key, undefined]),
)
mock.module('../current-user', () =>
  Object.assign(
    { ...currentUserModuleKeys },
    (() => ({
      useCurrentUser: hooks.useCurrentUser,
    }))(),
  ),
)
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const verificationRunsModuleKeys = Object.fromEntries(
  Object.keys(await import('../verification-runs')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../verification-runs', () =>
  Object.assign(
    { ...verificationRunsModuleKeys },
    (() => ({
      useOrganisationVerificationRuns: hooks.useOrganisationVerificationRuns,
      useVerificationRunDocuments: hooks.useVerificationRunDocuments,
    }))(),
  ),
)
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const mattersModuleKeys = Object.fromEntries(
  Object.keys(await import('../matters')).map((key) => [key, undefined]),
)
mock.module('../matters', () =>
  Object.assign(
    { ...mattersModuleKeys },
    (() => ({
      useMattersList: hooks.useMattersList,
    }))(),
  ),
)
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const tanstackReactRouterModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...tanstackReactRouterModuleKeys },
    (() => ({
      Link: ({ to, children }: { to?: string; children: ReactNode }) => (
        <a href={to ?? '#'}>{children}</a>
      ),
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { VerifyRouteView } = await import('./verify')

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
    summary: { findingCount: 1, flaggedCount: 0, reviewRequiredCount: 0 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function listResult(
  runs: VerificationRun[],
  overrides: Record<string, unknown> = {},
) {
  return {
    isPending: false,
    isError: false,
    runs,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  }
}

function signedIn() {
  hooks.useCurrentUser.mockReturnValue({
    data: { organisation: { id: 'org_1' } },
  })
  hooks.useVerificationRunDocuments.mockReturnValue(
    new Map([
      ['doc_1', { status: 'available', filename: 'demo-fixture.docx' }],
    ]),
  )
  hooks.useMattersList.mockReturnValue({
    data: [{ id: 'mtr_1', name: 'Potanina v Potanin appeal' }],
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VerifyRouteView', () => {
  it('shows the loading state while runs are pending', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: true,
      isError: false,
      runs: [],
    })
    const { container } = render(<VerifyRouteView />)
    expect(container.querySelector('.h-24')).toBeTruthy()
  })

  it('shows an actionable empty state rather than the old placeholder', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue(listResult([]))
    render(<VerifyRouteView />)
    expect(screen.getByText('No verification runs yet')).toBeTruthy()
    expect(screen.queryByText('In development')).toBeNull()
    // The page cannot start a run; it must send the user to where one starts.
    expect(
      screen.getByRole('link', { name: 'Open matters' }).getAttribute('href'),
    ).toBe('/matters')
  })

  it('surfaces a runs failure', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('verify service is down'),
      runs: [],
    })
    render(<VerifyRouteView />)
    expect(screen.getByText('Verification runs are unavailable')).toBeTruthy()
    expect(screen.getByText('verify service is down')).toBeTruthy()
  })

  it('lists completed, review-required, and failed runs with their document', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue(
      listResult([
        run({
          id: 'vrun_review',
          summary: {
            findingCount: 2,
            flaggedCount: 0,
            reviewRequiredCount: 1,
          },
        }),
        run({
          id: 'vrun_failed',
          status: 'failed',
          failureCode: 'execution_failed',
        }),
        run({ id: 'vrun_clean' }),
      ]),
    )
    render(<VerifyRouteView />)
    // Identity is the document filename and matter, never the raw run or
    // version UUID as the principal label.
    expect(screen.getAllByText('demo-fixture.docx')).toHaveLength(3)
    expect(
      screen.getAllByText(/Potanina v Potanin appeal/).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('vrun_review')).toBeNull()
    expect(screen.getByText('Review required (1)')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getAllByText('Completed')).toHaveLength(2)
    expect(screen.getAllByText('Open document')).toHaveLength(3)
    // The stored version stays visible beside the friendly identity.
    expect(screen.getAllByText('ver_1').length).toBeGreaterThan(0)
  })

  it('does not present a flagged run as a plain green completion', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue(
      listResult([
        run({
          id: 'vrun_flagged',
          summary: {
            findingCount: 3,
            flaggedCount: 2,
            reviewRequiredCount: 1,
          },
        }),
      ]),
    )
    render(<VerifyRouteView />)
    expect(screen.getByText('Flagged findings (2)')).toBeTruthy()
    // The result is announced, not left to colour.
    expect(
      screen.getByText('Attention required: flagged findings were found.'),
    ).toBeTruthy()
  })

  it('offers an explicit, bounded continuation for more runs', () => {
    signedIn()
    const fetchNextPage = vi.fn()
    hooks.useOrganisationVerificationRuns.mockReturnValue(
      listResult([run({ id: 'vrun_page_1' })], {
        hasNextPage: true,
        fetchNextPage,
      }),
    )
    render(<VerifyRouteView />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more runs' }))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('shows a pending document lookup as loading, never as unavailable', () => {
    signedIn()
    hooks.useVerificationRunDocuments.mockReturnValue(
      new Map([['doc_1', { status: 'pending' }]]),
    )
    hooks.useOrganisationVerificationRuns.mockReturnValue(listResult([run()]))
    render(<VerifyRouteView />)
    expect(screen.queryByText('Document unavailable')).toBeNull()
    expect(screen.getByText('Loading document…')).toBeTruthy()
  })

  it('reserves the unavailable state for a completed failed lookup', () => {
    signedIn()
    hooks.useVerificationRunDocuments.mockReturnValue(
      new Map([['doc_1', { status: 'unavailable' }]]),
    )
    hooks.useOrganisationVerificationRuns.mockReturnValue(listResult([run()]))
    render(<VerifyRouteView />)
    expect(screen.getByText('Document unavailable')).toBeTruthy()
  })

  it('keeps a valid run visible when another document lookup fails', () => {
    signedIn()
    hooks.useVerificationRunDocuments.mockReturnValue(
      new Map([
        ['doc_1', { status: 'available', filename: 'demo-fixture.docx' }],
        ['doc_2', { status: 'unavailable' }],
      ]),
    )
    hooks.useOrganisationVerificationRuns.mockReturnValue(
      listResult([
        run({ id: 'vrun_1', documentId: 'doc_1' }),
        run({ id: 'vrun_2', documentId: 'doc_2' }),
      ]),
    )
    render(<VerifyRouteView />)
    expect(screen.getByText('demo-fixture.docx')).toBeTruthy()
    expect(screen.getByText('Document unavailable')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open document' })).toHaveLength(
      2,
    )
  })

  it('places a failed run at its recorded failure time', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue(
      listResult([
        run({
          status: 'failed',
          failureCode: 'execution_failed',
          createdAt: '2026-09-14T00:00:00.000Z',
          completedAt: '2026-09-14T03:00:00.000Z',
        }),
      ]),
    )
    render(<VerifyRouteView />)
    const at = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    expect(
      screen.getByText((content) =>
        content.includes(`Failed ${at('2026-09-14T03:00:00.000Z')}`),
      ),
    ).toBeTruthy()
  })

  it('shows an account-loading state before the account resolves', () => {
    hooks.useCurrentUser.mockReturnValue({ data: undefined })
    hooks.useVerificationRunDocuments.mockReturnValue(new Map())
    hooks.useMattersList.mockReturnValue({ data: [] })
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: true,
      isError: false,
      runs: [],
    })
    render(<VerifyRouteView />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByText('No organisation yet')).toBeNull()
  })

  it('explains an organisationless account instead of loading forever', () => {
    hooks.useCurrentUser.mockReturnValue({ data: { organisation: null } })
    hooks.useVerificationRunDocuments.mockReturnValue(new Map())
    hooks.useMattersList.mockReturnValue({ data: [] })
    // A disabled infinite query stays pending; the view must not read that as
    // an organisation's runs still loading.
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: true,
      isError: false,
      runs: [],
    })
    render(<VerifyRouteView />)
    expect(screen.getByText('No organisation yet')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open settings' }).getAttribute('href'),
    ).toBe('/settings')
    // No organisation-scoped request may be fired for an organisationless user.
    expect(hooks.useOrganisationVerificationRuns).toHaveBeenCalledWith(false)
  })

  it('still shows the runs skeleton while an organisation loads its runs', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: true,
      isError: false,
      runs: [],
    })
    const { container } = render(<VerifyRouteView />)
    expect(container.querySelector('.h-24')).toBeTruthy()
    expect(screen.queryByText('No organisation yet')).toBeNull()
  })
})
