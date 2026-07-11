import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

/**
 * Session-expiry handling for route loaders.
 *
 * The frame gates on better-auth session presence, but a route loader that
 * awaits `ensureQueryData`/`prefetchQuery` before render can hit `/api/me`
 * (or another authed endpoint) and receive a 401 if the session cookie
 * expired between the frame check and the loader. Rather than surfacing a
 * broken screen, an unauthenticated response during a guarded call throws a
 * TanStack Router `redirect({ to: '/sign-in' })`.
 *
 * Throwing (rather than `window.location.assign`) works correctly in every
 * environment the shell supports: web path history, web SSR, and the desktop
 * renderer's hash history — the router resolves `/sign-in` through whichever
 * history is configured. It also ensures callers do not continue into further
 * prefetches after a dead session.
 *
 * Usage in a route file:
 *   loader: ({ context }) => guardAuth(context.queryClient, () =>
 *     context.queryClient.ensureQueryData(currentUserQueryOptions()),
 *   )
 */
export async function guardAuth(
  _queryClient: QueryClient,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      throw redirect({ to: '/sign-in' })
    }
    throw error
  }
}
