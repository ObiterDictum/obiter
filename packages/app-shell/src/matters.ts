import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

/**
 * Real matter + document domain types, mirroring the wire shapes returned by
 * `services/api` (org-scoped, audited matters/documents endpoints). These live
 * in the shell rather than `@obiter/contracts` because the matters/documents
 * APIs do not yet have shared request/response schemas there.
 */

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

/** Query key factory — the single source of truth for matters cache keys. */
export const mattersKeys = {
  all: ['matters'] as const,
  lists: () => [...mattersKeys.all, 'list'] as const,
  detail: (matterId: string) => [...mattersKeys.all, 'detail', matterId] as const,
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
      const response = await apiFetch<MatterResponse>(`/api/matters/${matterId}`)
      return response.matter
    },
  })
}

/**
 * Create a matter and refresh the list. Per TanStack Query conventions, the
 * list query is invalidated on success (the new row appears on next read
 * without a manual reload) and the new matter is optimistically inserted into
 * the list cache.
 */
export function useCreateMatter(): UseMutationResult<MatterRecord, Error, CreateMatterInput> {
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

/** Matters list via TanStack Query. */
export function useMattersList() {
  return useQuery(mattersListQueryOptions())
}

/** Single matter via TanStack Query. */
export function useMatter(matterId: string) {
  return useQuery(matterQueryOptions(matterId))
}
