import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'
import { documentsKeys } from './documents'

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

/** Query key factory — the single source of truth for matters cache keys. */
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

/**
 * Create a matter and refresh the list. Per TanStack Query conventions, the
 * list query is invalidated on success (the new row appears on next read
 * without a manual reload) and the new matter is optimistically inserted into
 * the list cache.
 */
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

/** Matters list via TanStack Query. */
export function useMattersList(options?: { enabled?: boolean }) {
  return useQuery({
    ...mattersListQueryOptions(),
    enabled: options?.enabled ?? true,
  })
}

/** Single matter via TanStack Query. */
export function useMatter(
  matterId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...matterQueryOptions(matterId),
    enabled: options?.enabled ?? true,
  })
}

/**
 * Soft-delete a matter and its documents/runs (owner/admin only). On success
 * the detail is removed from cache and the list invalidated so the matter
 * disappears on next read.
 */
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
