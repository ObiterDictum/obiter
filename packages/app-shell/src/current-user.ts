import {
  type MutationOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { CurrentOrganisation, MeResponse } from '@obiter/contracts'
import { apiFetch, ApiError } from './api'

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

export interface CreateOrganisationResult {
  ok: boolean
  message?: string
  organisation?: CurrentOrganisation
}

/**
 * Creates the signed-in user's organisation via POST /api/organisations.
 * On success, the current-user cache is updated immediately with the created
 * organisation (role becomes 'owner') so Settings flips from the create form
 * to the organisation summary without waiting for a refetch, and the query is invalidated
 * to reconcile with the server.
 */
export function createOrganisationMutationOptions(): MutationOptions<
  CurrentOrganisation,
  ApiError,
  { name: string }
> {
  const queryClient = useQueryClient()
  return {
    mutationFn: async (input) => {
      const result = await apiFetch<{ organisation: CurrentOrganisation }>(
        '/api/organisations',
        {
          method: 'POST',
          body: JSON.stringify({ name: input.name }),
        },
      )
      return result.organisation
    },
    onSuccess: (organisation) => {
      // Merge the created organisation into the cached /api/me so the UI
      // reflects it immediately; the role of the creating user is 'owner'.
      queryClient.setQueryData<MeResponse>(['current-user'], (prev) =>
        prev ? { user: { ...prev.user, role: 'owner' }, organisation } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  }
}

export function useCreateOrganisation() {
  return useMutation(createOrganisationMutationOptions())
}

/**
 * Owner-only rename via PATCH /api/organisations/:organisationId. Merges the
 * renamed organisation into the cached /api/me so Settings and Home reflect
 * it immediately, then invalidates to reconcile with the server.
 */
export function useRenameOrganisation(organisationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const result = await apiFetch<{ organisation: CurrentOrganisation }>(
        `/api/organisations/${organisationId}`,
        { method: 'PATCH', body: JSON.stringify({ name: input.name }) },
      )
      return result.organisation
    },
    onSuccess: (organisation) => {
      queryClient.setQueryData<MeResponse>(['current-user'], (prev) =>
        prev ? { ...prev, organisation } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  })
}
