// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
      data: undefined,
    })
    const { container } = render(<VerifyRouteView />)
    expect(container.querySelector('.h-24')).toBeTruthy()
  })

  it('shows an actionable empty state rather than the old placeholder', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: { runs: [] },
    })
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
      data: undefined,
    })
    render(<VerifyRouteView />)
    expect(screen.getByText('Verification runs are unavailable')).toBeTruthy()
    expect(screen.getByText('verify service is down')).toBeTruthy()
  })

  it('lists completed, review-required, and failed runs with their document', () => {
    signedIn()
    hooks.useOrganisationVerificationRuns.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        runs: [
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
        ],
      },
    })
    render(<VerifyRouteView />)
    expect(screen.getByText('vrun_review')).toBeTruthy()
    expect(screen.getByText('vrun_failed')).toBeTruthy()
    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getAllByText('Open document')).toHaveLength(3)
  })
})
