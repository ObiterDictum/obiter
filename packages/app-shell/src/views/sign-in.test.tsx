import '@obiter/test-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'

const authMocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  verifyTwoFactorSignIn: vi.fn(),
  requestMagicLink: vi.fn(),
  navigate: vi.fn(),
  resendVerificationEmail: vi.fn(),
}))

const searchState = vi.hoisted(() => ({
  token: undefined as string | undefined,
}))

const authModuleKeys = Object.fromEntries(
  Object.keys(await import('../auth')).map((key) => [key, undefined]),
)
mock.module('../auth', () =>
  Object.assign(
    { ...authModuleKeys },
    (() => ({
      useAuth: () => ({
        session: null,
        isPending: false,
        signInWithEmail: authMocks.signInWithEmail,
        verifyTwoFactorSignIn: authMocks.verifyTwoFactorSignIn,
        requestMagicLink: authMocks.requestMagicLink,
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
        resendVerificationEmail: authMocks.resendVerificationEmail,
        signOut: vi.fn(),
      }),
    }))(),
  ),
)

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
    }))(),
  ),
)

const { SignInRouteView } = await import('./sign-in')

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
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

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
      fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    })

    await waitFor(() => {
      expect(authMocks.navigate).toHaveBeenCalledWith({ to: '/' })
    })
    expect(screen.queryByText(/Sign-in failed/i)).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

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

  it('points a person who needs access at /request-access', () => {
    render(<SignInRouteView platform="web" />)
    expect(
      screen
        .getByRole('link', { name: /request access/i })
        .getAttribute('href'),
    ).toBe('/request-access')
  })

  it('does not offer request access in the desktop app', () => {
    render(<SignInRouteView platform="desktop" />)
    expect(screen.queryByRole('link', { name: /request access/i })).toBeNull()
  })

  it('surfaces unexpected thrown errors instead of clearing silently', async () => {
    authMocks.signInWithEmail.mockRejectedValueOnce(new Error('Network down'))

    render(<SignInRouteView platform="desktop" />)
    fillPasswordForm('lex@obiter.dev', 'password123')
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    await waitFor(() => {
      expect(screen.getByText('Network down')).toBeTruthy()
    })
    expect(authMocks.navigate).not.toHaveBeenCalled()
  })

  it('moves to the second-factor step when the password sign-in needs one', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: true,
      twoFactor: true,
    })

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('staff@obiter.dev', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Two-factor authentication' }),
      ).toBeTruthy()
    })
    expect(authMocks.navigate).not.toHaveBeenCalled()
    const codeInput = screen.getByLabelText('Authentication code')
    expect(codeInput.getAttribute('autocomplete')).toBe('one-time-code')
    expect(codeInput.getAttribute('inputmode')).toBe('numeric')
  })

  it('verifies a TOTP code on the second step and navigates home', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: true,
      twoFactor: true,
    })
    authMocks.verifyTwoFactorSignIn.mockResolvedValueOnce({ ok: true })
    authMocks.navigate.mockResolvedValueOnce(undefined)

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('staff@obiter.dev', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText('Authentication code')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '123456' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Verify and sign in' }),
      )
    })

    await waitFor(() => {
      expect(authMocks.verifyTwoFactorSignIn).toHaveBeenCalledWith({
        code: '123456',
        backupCode: false,
        trustDevice: false,
      })
    })
    await waitFor(() => {
      expect(authMocks.navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('sends a backup code through the backup-code path', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: true,
      twoFactor: true,
    })
    authMocks.verifyTwoFactorSignIn.mockResolvedValueOnce({ ok: true })
    authMocks.navigate.mockResolvedValueOnce(undefined)

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('staff@obiter.dev', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText('Authentication code')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Use a backup code' }))
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'abcde-fghij' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Verify and sign in' }),
      )
    })

    await waitFor(() => {
      expect(authMocks.verifyTwoFactorSignIn).toHaveBeenCalledWith({
        code: 'abcde-fghij',
        backupCode: true,
        trustDevice: false,
      })
    })
  })

  it('shows the verification error and stays on the second step', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: true,
      twoFactor: true,
    })
    authMocks.verifyTwoFactorSignIn.mockResolvedValueOnce({
      ok: false,
      message: 'That code is not correct. Check it and try again.',
    })

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('staff@obiter.dev', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText('Authentication code')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '000000' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Verify and sign in' }),
      )
    })

    await waitFor(() => {
      expect(
        screen.getByText('That code is not correct. Check it and try again.'),
      ).toBeTruthy()
    })
    expect(authMocks.navigate).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'Two-factor authentication' }),
    ).toBeTruthy()
  })

  it('returns to the password step when sign-in restarts', async () => {
    authMocks.signInWithEmail.mockResolvedValueOnce({
      ok: true,
      twoFactor: true,
    })

    render(<SignInRouteView platform="web" />)
    fillPasswordForm('staff@obiter.dev', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText('Authentication code')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Start sign-in again' }))

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
    })
    expect(screen.queryByLabelText('Authentication code')).toBeNull()
  })

  it('passes an invite accept callbackURL when magic-link sign-in has a token', async () => {
    searchState.token = 'invite-token'
    authMocks.requestMagicLink.mockResolvedValueOnce({ ok: true })

    render(<SignInRouteView platform="web" />)
    fireEvent.click(screen.getByRole('button', { name: /email link/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /email link/i }))
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
