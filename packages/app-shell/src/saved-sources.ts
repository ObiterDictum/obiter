import { queryOptions, useQuery } from '@tanstack/react-query'
import type { SavedMatterSource } from '@obiter/contracts'
import { apiFetch } from './api'

/**
 * Sources kept with a matter, read from the matter's own endpoint so the API's
 * matter access check decides what is visible.
 */
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

/**
 * A saved provision's corpus identity back into its parts: the Act identity is
 * the first three path segments (ukpga/2010/15), the rest is the provision's
 * label path, so the row links to the same page search links to.
 */
export function splitLegislationSourceId(sourceId: string) {
  const parts = sourceId.split('/')
  const documentIdentity = parts.slice(0, 3).join('/')
  return {
    documentIdentity,
    labelPath: parts.slice(3).join('/'),
  }
}
