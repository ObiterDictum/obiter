// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { VerificationRun } from '@obiter/contracts'
import { VerifyRouteView } from './verify'

const hooks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useOrganisationVerificationRuns: vi.fn(),
}))

vi.mock('../current-user', () => ({
  useCurrentUser: hooks.useCurrentUser,
}))
vi.mock('../verification-runs', () => ({
  useOrganisationVerificationRuns: hooks.useOrganisationVerificationRuns,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="#document">{children}</a>
  ),
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
    expect(screen.getByText('vrun_review')).toBeTruthy()
    expect(screen.getByText('vrun_failed')).toBeTruthy()
    expect(screen.getByText('Review required (1)')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getAllByText('Completed')).toHaveLength(2)
    expect(screen.getAllByText('Open document')).toHaveLength(3)
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
})
