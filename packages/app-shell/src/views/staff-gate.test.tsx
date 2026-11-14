import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { MeResponse } from '@obiter/contracts'

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
}))

mock.module('../current-user', () => ({
  useCurrentUser: mocks.useCurrentUser,
}))

const routerModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...routerModuleKeys },
    (() => ({
      Link: ({
        children,
        to,
        search,
        className,
      }: {
        children: ReactNode
        to?: string
        search?: { section?: string }
        className?: string
      }) => {
        const href =
          typeof to === 'string'
            ? search?.section
              ? `${to}?section=${search.section}`
              : to
            : '#'
        return (
          <a href={href} className={className}>
            {children}
          </a>
        )
      },
    }))(),
  ),
)

const { StaffGate } = await import('./staff-gate')

const ME_BASE: MeResponse = {
  isStaff: false,
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: 'member' },
  organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
}

function signedIn(me: MeResponse) {
  mocks.useCurrentUser.mockReturnValue({ data: me })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('StaffGate', () => {
  it('shows the not-found state to a non-staff user', () => {
    signedIn(ME_BASE)
    render(
      <StaffGate>
        <div>staff route content</div>
      </StaffGate>,
    )

    expect(screen.getByText('We cannot find that page')).toBeTruthy()
    expect(screen.queryByText('staff route content')).toBeNull()
  })

  it('explains that staff need two-factor when the account has not enabled it', () => {
    signedIn({ ...ME_BASE, isStaff: true, twoFactorEnabled: false })
    render(
      <StaffGate>
        <div>staff route content</div>
      </StaffGate>,
    )

    expect(
      screen.getByText('Staff accounts need two-factor authentication'),
    ).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open Security settings' })
    expect(link.getAttribute('href')).toBe('/settings?section=security')
    expect(screen.queryByText('staff route content')).toBeNull()
  })

  it('renders the staff screen when the staff account has two-factor enabled', () => {
    signedIn({
      ...ME_BASE,
      isStaff: true,
      twoFactorEnabled: true,
      twoFactorEnabledAt: '2026-01-02T03:04:05.000Z',
    })
    render(
      <StaffGate>
        <div>staff route content</div>
      </StaffGate>,
    )

    expect(screen.getByText('staff route content')).toBeTruthy()
    expect(
      screen.queryByText('Staff accounts need two-factor authentication'),
    ).toBeNull()
  })
})
