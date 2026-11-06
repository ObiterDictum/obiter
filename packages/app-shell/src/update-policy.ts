import { useQuery } from '@tanstack/react-query'
import { apiFetch, ApiError } from './api'

export const updatePolicyKey = (id: string | null) =>
  ['organisation-update-policy', id] as const

export const updatePolicyPath = (id: string) =>
  `/api/organisations/${id}/update-policy`

function readRequireUpdates(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'requireUpdates' in body &&
    body.requireUpdates === true
  )
}

export function useUpdatePolicy(id: string | null, enabled = true) {
  return useQuery({
    queryKey: updatePolicyKey(id),
    enabled: enabled && id !== null,
    queryFn: async () => {
      if (!id) return { requireUpdates: false }
      try {
        return {
          requireUpdates: readRequireUpdates(
            await apiFetch<unknown>(updatePolicyPath(id)),
          ),
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          return { requireUpdates: false }
        throw error
      }
    },
  })
}
