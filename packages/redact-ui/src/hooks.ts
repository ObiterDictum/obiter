import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, declaredFileType } from '@obiter/app-shell'
import type {
  FinalizeInput,
  FinalizeResponse,
  RedactionRun,
  SpanDecisionInput,
} from './types'

const runKey = (runId: string) => ['redaction-run', runId] as const
const runsKey = ['redaction-runs'] as const

export function useRedactionRuns() {
  return useQuery({
    queryKey: runsKey,
    queryFn: () => apiFetch<{ runs: RedactionRun[] }>('/api/redaction-runs'),
    staleTime: 30_000,
  })
}

export function useCreateRedactionRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { filename: string; text: string }) =>
      apiFetch<{ run: RedactionRun }>('/api/redaction-runs', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsKey }),
  })
}

/**
 * Soft-delete a standalone redaction run (owner/admin only). On success the
 * run detail is removed from cache and the runs list invalidated.
 */
export function useDeleteRedactionRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetch(`/api/redaction-runs/${runId}`, { method: 'DELETE' }),
    onSuccess: (_data, runId) => {
      queryClient.removeQueries({ queryKey: runKey(runId) })
      queryClient.invalidateQueries({ queryKey: runsKey })
    },
  })
}

export function useCreateUploadedRedactionRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.set('file', file)
      form.set('fileType', declaredFileType(file))
      return apiFetch<{ run: RedactionRun }>('/api/redaction-runs', {
        method: 'POST',
        body: form,
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsKey }),
  })
}

export function useCreateDocumentRedactionRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      apiFetch<{ run: RedactionRun }>(
        `/api/documents/${documentId}/redaction-runs`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: (_result, documentId) => {
      void queryClient.invalidateQueries({ queryKey: runsKey })
      void queryClient.invalidateQueries({
        queryKey: ['document-redaction-runs', documentId],
      })
    },
  })
}

export function useRedactionRun(runId: string) {
  return useQuery({
    queryKey: runKey(runId),
    queryFn: async () =>
      (await apiFetch<{ run: RedactionRun }>(`/api/redaction-runs/${runId}`))
        .run,
    refetchInterval: (query) =>
      query.state.data?.status === 'detecting' ? 5_000 : false,
    staleTime: 30_000,
  })
}

export function useRedactionDocumentText(runId: string) {
  return useQuery({
    queryKey: ['redaction-run-document-text', runId],
    queryFn: () =>
      apiFetch<{ text: string }>(`/api/redaction-runs/${runId}/document-text`),
    staleTime: 30_000,
  })
}

export function useRedactionOutput(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['redaction-run-output', runId],
    queryFn: () =>
      apiFetch<{ text: string }>(`/api/redaction-runs/${runId}/output`),
    enabled,
    staleTime: 30_000,
  })
}

export function useSpanDecision(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ spanId, decision }: SpanDecisionInput) =>
      apiFetch<{ run: RedactionRun }>(
        `/api/redaction-runs/${runId}/spans/${spanId}/decision`,
        { method: 'POST', body: JSON.stringify({ decision }) },
      ),
    onSuccess: ({ run }) => queryClient.setQueryData(runKey(runId), run),
  })
}

export function useFinalizeRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ outputMode }: FinalizeInput) =>
      apiFetch<FinalizeResponse>(`/api/redaction-runs/${runId}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ outputMode }),
      }),
    onSuccess: ({ run }) => {
      // Immediate run detail update (status → finalized, outputArtifactId, summary).
      queryClient.setQueryData(runKey(runId), run)
      // Reconcile with server + enable/refetch output; refresh list surfaces.
      void queryClient.invalidateQueries({ queryKey: runKey(runId) })
      void queryClient.invalidateQueries({
        queryKey: ['redaction-run-output', runId],
      })
      void queryClient.invalidateQueries({ queryKey: runsKey })
      void queryClient.invalidateQueries({
        queryKey: ['document-redaction-runs'],
      })
    },
  })
}
