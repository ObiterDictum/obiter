// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '../api'
import { AcceptInviteRouteView } from './accept-invite'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
  resendVerificationEmail: vi.fn(),
  session: null as {
    user: { id: string; email?: string }
    session: { id: string }
  } | null,
  isPending: false,
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, apiFetch: mocks.apiFetch }
})

vi.mock('../auth', () => ({
  useAuth: () => ({
    session: mocks.session,
    isPending: mocks.isPending,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    requestMagicLink: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    resendVerificationEmail: mocks.resendVerificationEmail,
    signOut: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({ token: 'invite-token' }),
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode
    to?: string
    search?: { token?: string }
    className?: string
  }) => {
    const href =
      typeof to === 'string'
        ? search?.token
          ? `${to}?token=${search.token}`
          : to
        : '#'
    return (
      <a href={href} className={className}>
        {children}
      </a>
    )
  },
}))

function renderAccept() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AcceptInviteRouteView />
    </QueryClientProvider>,
  )
}

describe('AcceptInviteRouteView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = null
    mocks.isPending = false
  })

  afterEach(() => {
    cleanup()
  })

  it('sends signed-out users to sign-up with the token preserved', () => {
    renderAccept()
    expect(
      screen
        .getByRole('link', { name: /create an account/i })
        .getAttribute('href'),
    ).toBe('/sign-up?token=invite-token')
  })

  it('accepts the invite and routes home when signed in', async () => {
    mocks.session = {
      user: { id: 'usr_1', email: 'ada@obiter.dev' },
      session: { id: 'ses_1' },
    }
    mocks.apiFetch.mockResolvedValueOnce({
      organisationId: 'org_1',
      role: 'member',
    })
    mocks.navigate.mockResolvedValueOnce(undefined)

    renderAccept()
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token: 'invite-token' }),
      })
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('shows the organisation-not-empty message and tells the user to revoke pending invites', async () => {
    mocks.session = { user: { id: 'usr_1' }, session: { id: 'ses_1' } }
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(
        'organisation_not_empty',
        'Your current organisation still has matters, other members, or pending invites. Obiter will not move or delete that data, so this invite cannot be accepted. Revoke pending invites first.',
        409,
        'req_1',
      ),
    )

    renderAccept()
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(
          /still has matters, other members, or pending invites/i,
        ),
      ).toBeTruthy()
      expect(
        screen.getByText(/Revoke your own pending invites first/i),
      ).toBeTruthy()
    })
  })

  it('renders a dedicated message when the invite is no longer valid', async () => {
    mocks.session = { user: { id: 'usr_1' }, session: { id: 'ses_1' } }
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(
        'invite_not_found',
        'This invite is no longer valid.',
        404,
        'req_2',
      ),
    )

    renderAccept()
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(
          /expired, been revoked, or has already been accepted/i,
        ),
      ).toBeTruthy()
    })
  })

  it('renders a dedicated message when the invite is for a different email', async () => {
    mocks.session = { user: { id: 'usr_1' }, session: { id: 'ses_1' } }
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(
        'forbidden',
        'This invite was sent to a different email address.',
        403,
        'req_3',
      ),
    )

    renderAccept()
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/sent to a different email address/i),
      ).toBeTruthy()
    })
  })

  it('offers a resend when the signed-in user is unverified', async () => {
    mocks.session = {
      user: { id: 'usr_1', email: 'ada@obiter.dev' },
      session: { id: 'ses_1' },
    }
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(
        'forbidden',
        'Verify your email before accepting an invite.',
        403,
        'req_4',
      ),
    )
    mocks.resendVerificationEmail.mockResolvedValueOnce({ ok: true })

    renderAccept()
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Verify your email before accepting an invite/i),
      ).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )
    await waitFor(() => {
      expect(mocks.resendVerificationEmail).toHaveBeenCalledWith(
        'ada@obiter.dev',
        `${window.location.origin}/invites/accept?token=invite-token`,
      )
    })
  })
})
