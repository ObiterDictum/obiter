import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@obiter/app-shell'
import type { FinalizeInput, FinalizeResponse, RedactionRun, SpanDecisionInput } from './types'

const runKey = (runId: string) => ['redaction-run', runId] as const

export function useRedactionRun(runId: string) {
  return useQuery({
    queryKey: runKey(runId),
    queryFn: async () => (await apiFetch<{ run: RedactionRun }>(`/api/redaction-runs/${runId}`)).run,
    refetchInterval: (query) => query.state.data?.status === 'detecting' ? 5_000 : false,
    staleTime: 30_000,
  })
}

export function useRedactionDocumentText(runId: string) {
  return useQuery({
    queryKey: ['redaction-run-document-text', runId],
    queryFn: () => apiFetch<{ text: string }>(`/api/redaction-runs/${runId}/document-text`),
    staleTime: 30_000,
  })
}

export function useSpanDecision(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ spanId, decision }: SpanDecisionInput) => apiFetch<{ run: RedactionRun }>(
      `/api/redaction-runs/${runId}/spans/${spanId}/decision`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    ),
    onSuccess: ({ run }) => queryClient.setQueryData(runKey(runId), run),
  })
}

export function useFinalizeRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ outputMode }: FinalizeInput) => apiFetch<FinalizeResponse>(
      `/api/redaction-runs/${runId}/finalize`,
      { method: 'POST', body: JSON.stringify({ outputMode }) },
    ),
    onSuccess: ({ run }) => queryClient.setQueryData(runKey(runId), run),
  })
}
