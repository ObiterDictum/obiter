import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'
import { documentsKeys } from './documents'

export type MatterStatus = 'active' | 'archived' | 'deleted'

export interface MatterRecord {
  id: string
  organisationId: string
  name: string
  description: string | null
  primaryJurisdiction: string
  secondaryJurisdictions: string[]
  legalDomains: string[]
  clientReference: string
  status: MatterStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
}

interface MatterListResponse {
  matters: MatterRecord[]
}

interface MatterResponse {
  matter: MatterRecord
}

export interface CreateMatterInput {
  name: string
  primaryJurisdiction: string
  description?: string | null
  secondaryJurisdictions?: string[]
  legalDomains?: string[]
  clientReference?: string
}

export function matterInitials(
  matter: Pick<MatterRecord, 'name' | 'clientReference'>,
): string {
  const reference = matter.clientReference.match(/^[A-Za-z]+/)?.[0]
  if (reference) return reference.slice(0, 3).toUpperCase()
  return matter.name
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word[0] ?? ''))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

export const mattersKeys = {
  all: ['matters'] as const,
  lists: () => [...mattersKeys.all, 'list'] as const,
  detail: (matterId: string) =>
    [...mattersKeys.all, 'detail', matterId] as const,
}

export function mattersListQueryOptions() {
  return queryOptions({
    queryKey: mattersKeys.lists(),
    queryFn: async () => {
      const response = await apiFetch<MatterListResponse>('/api/matters')
      return response.matters
    },
  })
}

export function matterQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: mattersKeys.detail(matterId),
    queryFn: async () => {
      const response = await apiFetch<MatterResponse>(
        `/api/matters/${matterId}`,
      )
      return response.matter
    },
  })
}

export function useCreateMatter(): UseMutationResult<
  MatterRecord,
  Error,
  CreateMatterInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateMatterInput) => {
      const response = await apiFetch<MatterResponse>('/api/matters', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return response.matter
    },
    onSuccess: (matter) => {
      queryClient.setQueryData(mattersKeys.detail(matter.id), matter)
      queryClient.invalidateQueries({ queryKey: mattersKeys.lists() })
    },
  })
}

export function useMattersList(options?: { enabled?: boolean }) {
  return useQuery({
    ...mattersListQueryOptions(),
    enabled: options?.enabled ?? true,
  })
}

export function useMatter(matterId: string, options?: { enabled?: boolean }) {
  return useQuery({
    ...matterQueryOptions(matterId),
    enabled: options?.enabled ?? true,
  })
}

export function useDeleteMatter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (matterId: string) => {
      await apiFetch(`/api/matters/${matterId}`, { method: 'DELETE' })
    },
    onSuccess: async (_data, matterId) => {
      queryClient.removeQueries({ queryKey: mattersKeys.detail(matterId) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mattersKeys.lists() }),
        queryClient.invalidateQueries({
          queryKey: documentsKeys.byMatter(matterId),
        }),
        queryClient.invalidateQueries({ queryKey: ['redaction-runs'] }),
        queryClient.invalidateQueries({
          queryKey: ['document-redaction-runs'],
        }),
      ])
    },
  })
}
