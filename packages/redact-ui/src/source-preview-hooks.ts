import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiFetch, apiFetchBlob } from '@obiter/app-shell'
import type { DocumentTextLayout } from './types'

export function useRedactionSource(
  runId: string,
  path: 'source-file',
  enabled: boolean,
): UseQueryResult<Blob, Error>
export function useRedactionSource(
  runId: string,
  path: 'layout',
  enabled: boolean,
): UseQueryResult<DocumentTextLayout, Error>
export function useRedactionSource(
  runId: string,
  path: 'source-file' | 'layout',
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['redaction-run-source', runId, path],
    queryFn: (): Promise<Blob | DocumentTextLayout> =>
      path === 'source-file'
        ? apiFetchBlob(`/api/redaction-runs/${runId}/source-file`)
        : apiFetch<{ layout: DocumentTextLayout }>(
            `/api/redaction-runs/${runId}/layout`,
          ).then((res) => res.layout),
    enabled,
    staleTime: 60_000,
  })
}
