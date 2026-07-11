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
import { ForgotPasswordRouteView } from './views/forgot-password'

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
}))

vi.mock('./auth', () => ({
  useAuth: () => ({ requestPasswordReset: mocks.requestPasswordReset }),
}))

function buildRouter() {
  const rootRoute = createRootRoute()
  const forgotRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    validateSearch: () => ({}),
    component: () => <ForgotPasswordRouteView />,
    loader: () => ({}),
  })
  return createRouter({
    routeTree: rootRoute.addChildren([forgotRoute]),
    history: createMemoryHistory({ initialEntries: ['/forgot-password'] }),
  })
}

function renderForgot() {
  return render(<RouterProvider router={buildRouter()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('ForgotPasswordRouteView — submit failure resets the pending state', () => {
  it('surfaces an error and re-enables the button when the request rejects', async () => {
    mocks.requestPasswordReset.mockRejectedValue(new Error('network down'))

    renderForgot()

    const emailInput = await screen.findByLabelText('Email')
    fireEvent.change(emailInput, { target: { value: 'lex@obiter.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    await waitFor(() => {
      expect(screen.getByText(/Check your connection and try again/)).toBeTruthy()
    })
    // submitting returned to false: the button is not stuck disabled.
    expect((screen.getByRole('button', { name: /send reset link/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('reaches the confirmation state on a successful request', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ ok: true, message: 'sent' })

    renderForgot()

    const emailInput = await screen.findByLabelText('Email')
    fireEvent.change(emailInput, { target: { value: 'lex@obiter.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    await waitFor(() => {
      expect(screen.getByText(/we have sent a link/i)).toBeTruthy()
    })
  })

  it('shows the returned message when the request fails with an error result', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ ok: false, message: 'Rate limited.' })

    renderForgot()

    const emailInput = await screen.findByLabelText('Email')
    fireEvent.change(emailInput, { target: { value: 'lex@obiter.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    await waitFor(() => {
      expect(screen.getByText('Rate limited.')).toBeTruthy()
    })
  })
})
