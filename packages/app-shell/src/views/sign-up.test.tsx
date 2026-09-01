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
import { SignUpRouteView } from './sign-up'

const authMocks = vi.hoisted(() => ({
  signUpWithEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
}))

const searchState = vi.hoisted(() => ({
  token: 'invite-token' as string | undefined,
}))

vi.mock('../auth', () => ({
  useAuth: () => ({
    session: null,
    isPending: false,
    signInWithEmail: vi.fn(),
    signUpWithEmail: authMocks.signUpWithEmail,
    requestMagicLink: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    resendVerificationEmail: authMocks.resendVerificationEmail,
    signOut: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => (searchState.token ? { token: searchState.token } : {}),
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

function fillForm() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Ada' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
    target: { value: 'ada@obiter.dev' },
  })
  fireEvent.change(document.querySelector('input[type="password"]')!, {
    target: { value: 'SuperSecret123!' },
  })
}

describe('SignUpRouteView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchState.token = 'invite-token'
  })

  afterEach(() => {
    cleanup()
  })

  it('reaches the check-your-email state on successful sign-up', async () => {
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: true,
      verificationRequired: true,
    })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Check your email to verify your account/i),
      ).toBeTruthy()
    })
    expect(authMocks.signUpWithEmail).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@obiter.dev',
      password: 'SuperSecret123!',
      callbackURL: `${window.location.origin}/invites/accept?token=invite-token`,
    })
    expect(
      screen
        .getByRole('link', { name: /back to sign in/i })
        .getAttribute('href'),
    ).toBe('/sign-in?token=invite-token')
  })

  it('passes an invite accept callbackURL when sign-up has a token', async () => {
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: true,
      verificationRequired: true,
    })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(authMocks.signUpWithEmail).toHaveBeenCalledWith({
        name: 'Ada',
        email: 'ada@obiter.dev',
        password: 'SuperSecret123!',
        callbackURL: `${window.location.origin}/invites/accept?token=invite-token`,
      })
    })
  })

  it('does not pass an invite callbackURL when sign-up has no token', async () => {
    searchState.token = undefined
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: true,
      verificationRequired: true,
    })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(authMocks.signUpWithEmail).toHaveBeenCalledWith({
        name: 'Ada',
        email: 'ada@obiter.dev',
        password: 'SuperSecret123!',
      })
    })
  })

  it('surfaces a sign-up failure without leaving the form', async () => {
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: false,
      message: 'Email already in use.',
    })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText('Email already in use.')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy()
  })

  it('resends verification from the check-your-email state', async () => {
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: true,
      verificationRequired: true,
    })
    authMocks.resendVerificationEmail.mockResolvedValueOnce({ ok: true })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend verification email/i }),
      ).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )
    await waitFor(() => {
      expect(authMocks.resendVerificationEmail).toHaveBeenCalledWith(
        'ada@obiter.dev',
        `${window.location.origin}/invites/accept?token=invite-token`,
      )
    })
  })

  it('passes an invite accept callbackURL when resending verification has a token', async () => {
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: true,
      verificationRequired: true,
    })
    authMocks.resendVerificationEmail.mockResolvedValueOnce({ ok: true })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend verification email/i }),
      ).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )
    await waitFor(() => {
      expect(authMocks.resendVerificationEmail).toHaveBeenCalledWith(
        'ada@obiter.dev',
        `${window.location.origin}/invites/accept?token=invite-token`,
      )
    })
  })

  it('does not pass an invite callbackURL when resending verification has no token', async () => {
    searchState.token = undefined
    authMocks.signUpWithEmail.mockResolvedValueOnce({
      ok: true,
      verificationRequired: true,
    })
    authMocks.resendVerificationEmail.mockResolvedValueOnce({ ok: true })

    render(<SignUpRouteView />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend verification email/i }),
      ).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )
    await waitFor(() => {
      expect(authMocks.resendVerificationEmail).toHaveBeenCalledWith(
        'ada@obiter.dev',
      )
    })
  })
})
