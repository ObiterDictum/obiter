import { queryOptions } from '@tanstack/react-query'
import { apiUrl } from './lib/api-url'

interface ChangelogEntry {
  date: string | null
  title: string
  url: string
}

interface ChangelogResponse {
  entries: ChangelogEntry[]
  source: string
}

export function changelogQueryOptions() {
  return queryOptions({
    queryKey: ['github-changelog'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/changelog'))
      if (!response.ok) {
        return {
          entries: [],
          source: 'github_unavailable',
        } satisfies ChangelogResponse
      }
      return (await response.json()) as ChangelogResponse
    },
    staleTime: 1000 * 60 * 10,
  })
}

export type { ChangelogEntry, ChangelogResponse }
