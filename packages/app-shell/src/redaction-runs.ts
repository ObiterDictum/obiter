import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'

/** Shared with @obiter/redact-ui so list caches stay coherent. */
export const redactionRunsQueryKey = ['redaction-runs'] as const

export interface RedactionRunListItem {
  id: string
  sourceFilename: string
  status: string
  matterId: string | null
  matterName?: string | null
}

/**
 * Lightweight redaction-run list for shell chrome (mode rail). Uses the same
 * query key as redact-ui so opening Redact does not refetch from scratch.
 */
export function useRedactionRunsList(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: redactionRunsQueryKey,
    queryFn: () =>
      apiFetch<{ runs: RedactionRunListItem[] }>('/api/redaction-runs'),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}
