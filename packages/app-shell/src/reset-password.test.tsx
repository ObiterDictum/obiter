// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ResetPasswordRouteView } from './views/reset-password'

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
}))

vi.mock('./auth', () => ({
  useAuth: () => ({ resetPassword: mocks.resetPassword }),
}))

function buildRouter(token?: string) {
  const rootRoute = createRootRoute()
  const resetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reset-password',
    validateSearch: () => ({}),
    component: () => <ResetPasswordRouteView />,
    loader: () => ({}),
  })
  const search = token ? `?token=${token}` : ''
  return createRouter({
    routeTree: rootRoute.addChildren([resetRoute]),
    history: createMemoryHistory({ initialEntries: [`/reset-password${search}`] }),
  })
}

function renderReset(token?: string) {
  return render(<RouterProvider router={buildRouter(token)} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

async function submitForm(password: string, confirm: string) {
  const pw = await screen.findByLabelText('New password')
  const cf = screen.getByLabelText('Confirm new password')
  fireEvent.change(pw, { target: { value: password } })
  fireEvent.change(cf, { target: { value: confirm } })
  fireEvent.submit(cf.closest('form')!)
}

describe('ResetPasswordRouteView — token failure vs retryable failure', () => {
  it('flips to the invalid-token state on a dead-token code (INVALID_TOKEN)', async () => {
    mocks.resetPassword.mockResolvedValue({ ok: false, message: 'Invalid token', code: 'INVALID_TOKEN' })

    renderReset('tok_expired')

    await submitForm('newpassword123', 'newpassword123')

    await waitFor(() => {
      expect(screen.getByText('This reset link is invalid or has expired.')).toBeTruthy()
    })
    expect(screen.getByText('Request a new reset link')).toBeTruthy()
  })

  it('flips to the invalid-token state on a TOKEN_EXPIRED code', async () => {
    mocks.resetPassword.mockResolvedValue({ ok: false, message: 'Token expired', code: 'TOKEN_EXPIRED' })

    renderReset('tok_expired')

    await submitForm('newpassword123', 'newpassword123')

    await waitFor(() => {
      expect(screen.getByText('Request a new reset link')).toBeTruthy()
    })
  })

  it('keeps the form and shows an inline error on PASSWORD_TOO_LONG (token still valid)', async () => {
    mocks.resetPassword.mockResolvedValue({
      ok: false,
      message: 'Password too long',
      code: 'PASSWORD_TOO_LONG',
    })

    renderReset('tok_valid')

    await submitForm('newpassword123', 'newpassword123')

    await waitFor(() => {
      expect(screen.getByText('Password too long')).toBeTruthy()
    })
    // The form is still present — the user can retry with the same token.
    expect(screen.queryByText('Request a new reset link')).toBeNull()
    expect(screen.getByLabelText('New password')).toBeTruthy()
  })

  it('keeps the form and shows a generic inline error on a codeless failure (network/5xx)', async () => {
    mocks.resetPassword.mockResolvedValue({ ok: false, message: undefined })

    renderReset('tok_valid')

    await submitForm('newpassword123', 'newpassword123')

    await waitFor(() => {
      expect(screen.getByText('Could not reset your password.')).toBeTruthy()
    })
    expect(screen.queryByText('Request a new reset link')).toBeNull()
  })

  it('keeps the form on a thrown reset call and resets the submitting state', async () => {
    mocks.resetPassword.mockRejectedValue(new Error('network down'))

    renderReset('tok_valid')

    await submitForm('newpassword123', 'newpassword123')

    await waitFor(() => {
      expect(screen.getByText(/Check your connection and try again/)).toBeTruthy()
    })
    // submitting reset to false (W2): the button is not stuck disabled.
    expect((screen.getByRole('button', { name: /reset password/i }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('Request a new reset link')).toBeNull()
  })
})

describe('ResetPasswordRouteView — client validation and in-flight guard', () => {
  it('renders the invalid-token state immediately when no token is present', async () => {
    renderReset()

    expect(await screen.findByText('This reset link is invalid or has expired.')).toBeTruthy()
  })

  it('shows a local error for a too-short password (not the token state)', async () => {
    renderReset('tok_valid')

    await submitForm('short', 'short')

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy()
    })
  })

  it('shows a local error for a too-long password (mirrors the server max of 128)', async () => {
    renderReset('tok_valid')

    await submitForm('x'.repeat(129), 'x'.repeat(129))

    await waitFor(() => {
      expect(screen.getByText('Password must be at most 128 characters.')).toBeTruthy()
    })
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it('does not call resetPassword twice on a rapid double-submit', async () => {
    let resolveFirst: (value: { ok: true }) => void = () => {}
    mocks.resetPassword.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )

    renderReset('tok_valid')

    const pw = await screen.findByLabelText('New password')
    const cf = screen.getByLabelText('Confirm new password')
    fireEvent.change(pw, { target: { value: 'newpassword123' } })
    fireEvent.change(cf, { target: { value: 'newpassword123' } })
    const form = cf.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form) // in-flight second submit — must be a no-op

    // Let the first call resolve.
    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledTimes(1))
    resolveFirst({ ok: true })

    // Even after settling, only the first submit ran.
    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledTimes(1))
  })
})
