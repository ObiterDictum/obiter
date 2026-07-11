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
import type { ReactNode } from 'react'
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

describe('ResetPasswordRouteView — token failure surfaces the "request a new link" state', () => {
  it('flips to the invalid-token state when submit fails for an expired/invalid token', async () => {
    // The email link points straight at this screen, so the token is validated
    // on submit. A failure means expired/used token.
    mocks.resetPassword.mockResolvedValue({ ok: false, message: 'Invalid token' })

    renderReset('tok_expired')

    await submitForm('newpassword123', 'newpassword123')

    await waitFor(() => {
      expect(
        screen.getByText('This reset link is invalid or has expired.'),
      ).toBeTruthy()
    })
    expect(screen.getByText('Request a new reset link')).toBeTruthy()
  })

  it('renders the invalid-token state immediately when no token is present', async () => {
    renderReset()

    expect(
      await screen.findByText('This reset link is invalid or has expired.'),
    ).toBeTruthy()
  })

  it('shows a local validation error for a too-short password (not the token state)', async () => {
    renderReset('tok_valid')

    await submitForm('short', 'short')

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy()
    })
  })
})
