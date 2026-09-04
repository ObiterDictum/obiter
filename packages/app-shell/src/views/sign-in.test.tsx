// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInRouteView } from './sign-in'

const authMocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  requestMagicLink: vi.fn(),
  navigate: vi.fn(),
  resendVerificationEmail: vi.fn(),
  provisionPendingOrganisation: vi.fn(),
}))

const searchState = vi.hoisted(() => ({
  token: undefined as string | undefined,
}))

vi.mock('../auth', () => ({
  useAuth: () => ({
    session: null,
    isPending: false,
    signInWithEmail: authMocks.signInWithEmail,
    signUpWithEmail: authMocks.signUpWithEmail,
    requestMagicLink: authMocks.requestMagicLink,
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    resendVerificationEmail: authMocks.resendVerificationEmail,
    signOut: vi.fn(),
  }),
}))

vi.mock('../pending-organisation', () => ({
  provisionPendingOrganisation: authMocks.provisionPendingOrganisation,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => authMocks.navigate,
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

function fillPasswordForm(email: string, password: string) {
  const emailInput = screen.getByRole('textbox', { name: 'Email' })
  const passwordInput = document.querySelector(
    'input[type="password"]',
  ) as HTMLInputElement
  fireEvent.change(emailInput, { target: { value: email } })
  fireEvent.change(passwordInput, { target: { value: password } })
}

describe('SignInRouteView — password submit outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchState.token = undefined
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a visible error and stays put when sign-in fails', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: false,
      message: 'Invalid email or password.',
    })

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('lex@obiter.dev', 'wrong-password')
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password.')).toBeTruthy()
    })
    expect(authMocks.navigate).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement)
        .value,
    ).toBe('lex@obiter.dev')
  })

  it('navigates to Home on successful sign-in', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({ ok: true })
    authMocks.navigate.mockResolvedValueOnce(undefined)

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('livetest@example.com', 'SuperSecret123!')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })

    await waitFor(() => {
      expect(authMocks.navigate).toHaveBeenCalledWith({ to: '/' })
    })
    expect(screen.queryByText(/Sign-in failed/i)).toBeNull()
  })

  it('claims a pending sign-up organisation name before leaving sign-in', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({ ok: true })
    authMocks.navigate.mockResolvedValueOnce(undefined)
    authMocks.provisionPendingOrganisation.mockResolvedValueOnce(true)

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('livetest@example.com', 'SuperSecret123!')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })

    await waitFor(() => {
      expect(authMocks.provisionPendingOrganisation).toHaveBeenCalled()
      expect(authMocks.navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('offers a resend when sign-in fails because the address is unverified', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: false,
      message: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
    })
    authMocks.resendVerificationEmail.mockResolvedValueOnce({ ok: true })

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('lex@obiter.dev', 'password123')
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Email not verified')).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )
    await waitFor(() => {
      expect(authMocks.resendVerificationEmail).toHaveBeenCalledWith(
        'lex@obiter.dev',
      )
    })
  })

  it('points account creation at /sign-up', () => {
    render(<SignInRouteView platform="web" />)
    expect(
      screen.getByRole('link', { name: /create one/i }).getAttribute('href'),
    ).toBe('/sign-up')
  })

  it('surfaces unexpected thrown errors instead of clearing silently', async () => {
    authMocks.signInWithEmail.mockRejectedValueOnce(new Error('Network down'))

    render(<SignInRouteView platform="desktop" />)
    fillPasswordForm('lex@obiter.dev', 'password123')
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Network down')).toBeTruthy()
    })
    expect(authMocks.navigate).not.toHaveBeenCalled()
  })

  it('passes an invite accept callbackURL when magic-link sign-in has a token', async () => {
    searchState.token = 'invite-token'
    authMocks.requestMagicLink.mockResolvedValueOnce({ ok: true })

    render(<SignInRouteView platform="web" />)
    fireEvent.click(screen.getByRole('button', { name: /magic link/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'lex@obiter.dev' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }))

    await waitFor(() => {
      expect(authMocks.requestMagicLink).toHaveBeenCalledWith(
        'lex@obiter.dev',
        `${window.location.origin}/invites/accept?token=invite-token`,
      )
    })
  })

  it('does not pass an invite callbackURL when magic-link sign-in has no token', async () => {
    authMocks.requestMagicLink.mockResolvedValueOnce({ ok: true })

    render(<SignInRouteView platform="web" />)
    fireEvent.click(screen.getByRole('button', { name: /magic link/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'lex@obiter.dev' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }))

    await waitFor(() => {
      expect(authMocks.requestMagicLink).toHaveBeenCalledWith(
        'lex@obiter.dev',
        undefined,
      )
    })
  })
})
