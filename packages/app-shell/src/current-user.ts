import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { apiFetch } from './api'

/**
 * Current-user data is always backed by the authenticated `GET /api/me` API.
 * A 401 is surfaced to the frame, which redirects protected routes to sign-in.
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
