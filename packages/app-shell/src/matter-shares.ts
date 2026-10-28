import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import type {
  MatterAccessLevel,
  MatterShareCreateResponse,
  MatterShareListResponse,
  MatterShareRevokeResponse,
} from '@obiter/contracts'
import { apiFetch } from './api'

/**
 * Matter access grants, from the API that already owns them. Only the matter's
 * owner may read or change shares, so callers offer the dialog only to them.
 */
const matterSharesKeys = {
  forMatter: (matterId: string) => ['matter-shares', matterId] as const,
}

function matterSharesQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: matterSharesKeys.forMatter(matterId),
    queryFn: () =>
      apiFetch<MatterShareListResponse>(`/api/matters/${matterId}/shares`),
    staleTime: 30_000,
  })
}

export function useMatterShares(
  matterId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...matterSharesQueryOptions(matterId),
    enabled: options?.enabled ?? true,
  })
}

export function useGrantMatterShare(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      granteeUserId: string
      accessLevel: MatterAccessLevel
    }) =>
      apiFetch<MatterShareCreateResponse>(`/api/matters/${matterId}/shares`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: matterSharesKeys.forMatter(matterId),
      }),
  })
}

export function useRevokeMatterShare(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (shareId: string) =>
      apiFetch<MatterShareRevokeResponse>(
        `/api/matters/${matterId}/shares/${shareId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: matterSharesKeys.forMatter(matterId),
      }),
  })
}
