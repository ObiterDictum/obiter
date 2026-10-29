import { queryOptions, useQuery } from '@tanstack/react-query'
import type { SavedMatterSource } from '@obiter/contracts'
import { apiFetch } from './api'

export const savedSourcesKeys = {
  all: ['matter-saved-sources'] as const,
  forMatter: (matterId: string) => [...savedSourcesKeys.all, matterId] as const,
}

function savedMatterSourcesQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: savedSourcesKeys.forMatter(matterId),
    queryFn: async () => {
      const response = await apiFetch<{ savedSources: SavedMatterSource[] }>(
        `/api/matters/${matterId}/saved-sources`,
      )
      return response.savedSources
    },
  })
}

export function useSavedMatterSources(matterId: string) {
  return useQuery(savedMatterSourcesQueryOptions(matterId))
}

export function splitLegislationSourceId(sourceId: string) {
  const parts = sourceId.split('/')
  const documentIdentity = parts.slice(0, 3).join('/')
  return {
    documentIdentity,
    labelPath: parts.slice(3).join('/'),
  }
}
