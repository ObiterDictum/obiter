import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

/**
 * Session-expiry handling for route loaders.
 *
 * The frame gates on better-auth session presence, but a route loader that calls
 * `ensureQueryData` before render can hit `/api/me` (or another authed endpoint)
 * and receive a 401 if the session cookie expired between the frame check and
 * the loader. Rather than surfacing a broken error screen, an unauthenticated
 * response during prefetch redirects to `/sign-in`.
 *
 * In the browser this is a `window.location` assignment so the reload re-runs
 * the frame's auth gate from scratch (the server-rendered shell has no cached
 * query state to leak). Outside the browser (SSR) the error rethrows so the
 * router's own error handling applies.
 */
export async function guardAuth(
  _queryClient: QueryClient,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      if (typeof window !== 'undefined') {
        window.location.assign('/sign-in')
      }
      return
    }
    throw error
  }
}
