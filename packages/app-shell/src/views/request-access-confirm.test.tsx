import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

const apiModule = { ...(await import('../api')) }
mock.module('../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const { ApiError } = await import('../api')
const { RequestAccessConfirmRouteView } =
  await import('./request-access-confirm')

function renderConfirm(entry: string) {
  const rootRoute = createRootRoute()
  const confirmRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/request-access/confirm',
    component: RequestAccessConfirmRouteView,
  })
  const requestAccessRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/request-access',
    component: () => <p>Request access page</p>,
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: () => <p>Sign in page</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      confirmRoute,
      requestAccessRoute,
      signInRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('access request confirmation', () => {
  it('sends the token to the confirm endpoint from the link', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'verified', next: 'sign_in' })
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', { name: "You're verified" })
    expect(api.apiFetch).toHaveBeenCalledWith('/api/access-requests/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: 'abc123' }),
    })
  })

  it('sends a verified applicant with an account to sign in', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'verified', next: 'sign_in' })
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', { name: "You're verified" })
    expect(
      screen
        .getByRole('link', { name: 'Continue to sign in' })
        .getAttribute('href'),
    ).toBe('/sign-in')
  })

  it('tells a verified applicant who has no account yet that set-up is next', async () => {
    api.apiFetch.mockResolvedValueOnce({
      status: 'verified',
      next: 'account_setup',
    })
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', { name: "You're verified" })
    expect(screen.getByText(/next step is to set your password/i)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href'),
    ).toBe('/sign-in')
  })

  it('says the organisation is being checked when the address is not yet known', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'pending_review' })
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', {
      name: "We're confirming your organisation",
    })
    expect(screen.getByText(/usually within one working day/i)).toBeTruthy()
  })

  it('offers a new link when the confirmation link has expired', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'expired' })
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', { name: 'This link has expired' })
    expect(
      screen
        .getByRole('link', { name: 'Request a new link' })
        .getAttribute('href'),
    ).toBe('/request-access')
  })

  it('says a link the API refuses is not valid', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'invalid' })
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', { name: 'This link is not valid' })
    expect(
      screen.getByRole('link', { name: 'Request access' }).getAttribute('href'),
    ).toBe('/request-access')
  })

  it('never calls the API for a link that carries no token', async () => {
    renderConfirm('/request-access/confirm')

    await screen.findByRole('heading', { name: 'This link is not valid' })
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('says the link was not used when the confirm endpoint cannot be reached', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('storage_unavailable', 'Service unavailable.', 503, 'req_3'),
    )
    renderConfirm('/request-access/confirm?token=abc123')

    await screen.findByRole('heading', { name: 'We could not check this link' })
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
