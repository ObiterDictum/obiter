import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { MeResponse } from '@ormont/contracts'
import { apiFetch } from './api'

/**
 * Real current-user data, backed by `GET /api/me`. Unauthenticated responses are
 * surfaced as errors (401 `unauthenticated`); the frame's auth gate redirects
 * the user to /sign-in (FR1). No demo me response is used on this path.
 */
export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: ['current-user'],
    queryFn: async () => apiFetch<MeResponse>('/api/me'),
    staleTime: 60 * 1000,
  })
}

export function useCurrentUser() {
  return useSuspenseQuery(currentUserQueryOptions())
}
