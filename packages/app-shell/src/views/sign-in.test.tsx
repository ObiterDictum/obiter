// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInRouteView } from './sign-in'

const authMocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  requestMagicLink: vi.fn(),
  navigate: vi.fn(),
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
    signOut: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => authMocks.navigate,
  useSearch: () => ({}),
  Link: ({ children, to, className }: { children: ReactNode; to?: string; className?: string }) => (
    <a href={typeof to === 'string' ? to : '#'} className={className}>
      {children}
    </a>
  ),
}))

function fillPasswordForm(email: string, password: string) {
  const emailInput = screen.getByRole('textbox', { name: 'Email' })
  const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
  fireEvent.change(emailInput, { target: { value: email } })
  fireEvent.change(passwordInput, { target: { value: password } })
}

describe('SignInRouteView — password submit outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect((screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe(
      'lex@obiter.dev',
    )
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
})
