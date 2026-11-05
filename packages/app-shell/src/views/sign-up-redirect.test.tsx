import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { SignUpRedirectView } from './sign-up-redirect'

function SignInPage() {
  return <p>Sign in page</p>
}

function RequestAccessPage() {
  return <p>Request access page</p>
}

function AcceptInvitePage() {
  // SAFETY: useSearch with strict:false is untyped; token is rendered as text and never dereferenced.
  const search = useSearch({ strict: false }) as { token?: string }
  return <p>Invite token {search.token ?? 'none'}</p>
}

function renderSignUp(entry: string, platform: 'web' | 'desktop' = 'web') {
  const rootRoute = createRootRoute()
  const signUpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-up',
    component: () => <SignUpRedirectView platform={platform} />,
  })
  const requestAccessRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/request-access',
    component: RequestAccessPage,
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: SignInPage,
  })
  const acceptInviteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/invites/accept',
    component: AcceptInvitePage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      signUpRoute,
      requestAccessRoute,
      signInRoute,
      acceptInviteRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

afterEach(() => {
  cleanup()
})

describe('closed sign-up route', () => {
  it('sends a plain sign-up link to the access request page', async () => {
    const router = renderSignUp('/sign-up')

    await screen.findByText('Request access page')
    expect(router.state.location.pathname).toBe('/request-access')
  })

  it('sends a plain sign-up link to sign in on desktop, which has no access request page', async () => {
    const router = renderSignUp('/sign-up', 'desktop')

    await screen.findByText('Sign in page')
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('replaces the sign-up entry so Back does not bounce off the redirect', async () => {
    const router = renderSignUp('/sign-up')

    await screen.findByText('Request access page')
    expect(router.history.canGoBack()).toBe(false)
  })

  it('keeps an invite link working by sending its token to invite acceptance', async () => {
    const router = renderSignUp('/sign-up?token=invite-token')

    await screen.findByText('Invite token invite-token')
    expect(router.state.location.pathname).toBe('/invites/accept')
  })
})
