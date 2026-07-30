import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiFetchBlob } from '@obiter/app-shell'
import type { DocumentTextLayout } from './types'

export function useRedactionSourceFile(
  runId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['redaction-run-source-file', runId],
    queryFn: () => apiFetchBlob(`/api/redaction-runs/${runId}/source-file`),
    enabled,
    staleTime: 60_000,
  })
}

export function useRedactionLayout(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['redaction-run-layout', runId],
    queryFn: async () =>
      (
        await apiFetch<{ layout: DocumentTextLayout }>(
          `/api/redaction-runs/${runId}/layout`,
        )
      ).layout,
    enabled,
    staleTime: 60_000,
  })
}
