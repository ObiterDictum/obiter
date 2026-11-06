import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  organisationUpdatePolicySchema,
  type OrganisationUpdatePolicy,
} from '@obiter/contracts'
import { apiFetch, ApiError } from './api'

const key = (id: string | null) => ['organisation-update-policy', id] as const
const path = (id: string) => `/api/organisations/${id}/update-policy`

export function useUpdatePolicy(id: string | null) {
  return useQuery({
    queryKey: key(id),
    enabled: id !== null,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!id) return { requireUpdates: false }
      try {
        return organisationUpdatePolicySchema.parse(
          await apiFetch<unknown>(path(id)),
        )
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          return { requireUpdates: false }
        throw error
      }
    },
  })
}

export function useChangeUpdatePolicy(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: OrganisationUpdatePolicy) =>
      organisationUpdatePolicySchema.parse(
        await apiFetch<unknown>(path(id), {
          method: 'PATCH',
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: (policy) => client.setQueryData(key(id), policy),
  })
}
