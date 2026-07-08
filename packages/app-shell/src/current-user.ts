import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { MeResponse } from '@ormont/contracts'
import { apiFetch } from './api'
import { createDemoMeResponse } from './fixtures'
import { DEV_AUTO_LOGIN } from './dev-session'

/**
 * Real current-user data, backed by `GET /api/me`. Unauthenticated responses are
 * surfaced as errors (401 `unauthenticated`); the frame's auth gate redirects
 * the user to /sign-in (FR1). No demo me response is used on this path.
 *
 * Dev auto-login returns the demo me response directly so the sidebar does not
 * 401 against the real (unprovisioned) API.
 */
export function currentUserQueryOptions() {
  if (DEV_AUTO_LOGIN) {
    return queryOptions({
      queryKey: ['current-user'],
      queryFn: async () => createDemoMeResponse(),
      staleTime: Infinity,
    })
  }

  return queryOptions({
    queryKey: ['current-user'],
    queryFn: async () => apiFetch<MeResponse>('/api/me'),
    staleTime: 60 * 1000,
  })
}

export function useCurrentUser() {
  return useSuspenseQuery(currentUserQueryOptions())
}
