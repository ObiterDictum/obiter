import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from './api'
import { currentUserQueryOptions } from './current-user'
import { changelogQueryOptions } from './changelog'
import { mattersListQueryOptions } from './matters'

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

/**
 * Organisation gate for org-scoped routes (matters, documents, redact).
 *
 * An authenticated but org-less user is a first-class state: they have signed
 * in but not yet created an organisation, so org-scoped surfaces would either
 * 403 at the API or render broken. Rather than letting them land on a dead
 * screen, this loader ensures /api/me is loaded and redirects org-less users
 * to Home, which renders the create-organisation surface.
 *
 * The /api/me fetch gets the same session-expiry handling as `guardAuth`: a
 * 401 (cookie expired between the frame check and the loader) redirects to
 * /sign-in rather than surfacing a broken error screen. An org-present user
 * passes through. The redirect is routing-level only — it does not change any
 * Redact internals.
 *
 * Usage in a route file:
 *   loader: ({ context }) => ensureOrganisation(context.queryClient)
 */
export async function ensureOrganisation(queryClient: QueryClient): Promise<void> {
  let me: MeResponse
  try {
    me = await queryClient.ensureQueryData(currentUserQueryOptions())
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      throw redirect({ to: '/sign-in' })
    }
    throw error
  }
  if (!me.organisation) {
    throw redirect({ to: '/' })
  }
}

/**
 * Home route loader: ensures the current user and changelog, then prefetches
 * the matters list only for an org-present user. Org-less users would 403 on
 * GET /api/matters, so the prefetch is skipped for them (Home renders the
 * create-organisation surface instead). The current-user/changelog fetches are
 * wrapped in `guardAuth` so a 401 redirects to /sign-in rather than throwing.
 *
 * Shared by the web and desktop Home routes so the org-aware prefetch decision
 * lives in one place.
 */
export async function prefetchHomeData(queryClient: QueryClient): Promise<void> {
  await guardAuth(queryClient, () =>
    Promise.all([
      queryClient.ensureQueryData(currentUserQueryOptions()),
      queryClient.ensureQueryData(changelogQueryOptions()),
    ]),
  )
  const me = queryClient.getQueryData<MeResponse>(['current-user'])
  if (me?.organisation) {
    await queryClient.prefetchQuery(mattersListQueryOptions())
  }
}
