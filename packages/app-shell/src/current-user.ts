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
 * On success, invalidates the current-user query so /api/me refetches and
 * the shell switches from the create-org state to matters — no full reload.
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    },
  }
}

export function useCreateOrganisation() {
  return useMutation(createOrganisationMutationOptions())
}
