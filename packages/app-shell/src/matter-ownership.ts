import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  memberOwnedMattersResponseSchema,
  matterTransferResponseSchema,
  type MatterTransferRequest,
} from '@obiter/contracts'
import { apiFetch } from './api'
import { mattersKeys } from './matters'

export function useMemberOwnedMatters(organisationId: string, userId: string) {
  return useQuery({
    queryKey: ['member-owned-matters', organisationId, userId],
    queryFn: async () =>
      memberOwnedMattersResponseSchema.parse(
        await apiFetch<unknown>(
          `/api/organisations/${organisationId}/members/${userId}/matters`,
        ),
      ).matters,
    staleTime: 0,
    retry: false,
  })
}

export function useTransferMatter(matterId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: MatterTransferRequest) =>
      matterTransferResponseSchema.parse(
        await apiFetch<unknown>(`/api/matters/${matterId}/transfer`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      ).matter,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: mattersKeys.all }),
        client.invalidateQueries({ queryKey: ['matter-shares', matterId] }),
        client.invalidateQueries({ queryKey: ['member-owned-matters'] }),
      ])
    },
  })
}
