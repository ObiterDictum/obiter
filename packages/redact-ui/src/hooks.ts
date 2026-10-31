import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  RedactionReturnResponse,
  RedactionSaveToMatterResponse,
} from '@obiter/contracts'
import {
  apiFetch,
  apiFetchBlob,
  declaredFileType,
  documentsKeys,
} from '@obiter/app-shell'
import type {
  FinalizeInput,
  FinalizeResponse,
  RedactionOutput,
  RedactionRun,
  RedetectResponse,
  SpanDecisionInput,
} from './types'

const runKey = (runId: string) => ['redaction-run', runId] as const
const runsKey = ['redaction-runs'] as const

export function redactionRunsQueryOptions() {
  return queryOptions({
    queryKey: runsKey,
    queryFn: () => apiFetch<{ runs: RedactionRun[] }>('/api/redaction-runs'),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.status === 'detecting')
        ? 2_000
        : false,
    staleTime: 30_000,
  })
}

export function useRedactionRuns(options?: { enabled?: boolean }) {
  return useQuery({
    ...redactionRunsQueryOptions(),
    enabled: options?.enabled ?? true,
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

export function redactionRunQueryOptions(runId: string) {
  return queryOptions({
    queryKey: runKey(runId),
    queryFn: async () =>
      (await apiFetch<{ run: RedactionRun }>(`/api/redaction-runs/${runId}`))
        .run,
    refetchInterval: (query) =>
      query.state.data?.status === 'detecting' ? 2_000 : false,
    staleTime: 30_000,
  })
}

export function useRedactionRun(runId: string) {
  return useQuery(redactionRunQueryOptions(runId))
}

export function redactionDocumentTextQueryOptions(runId: string) {
  return queryOptions({
    queryKey: ['redaction-run-document-text', runId],
    queryFn: () =>
      apiFetch<{ text: string }>(`/api/redaction-runs/${runId}/document-text`),
    staleTime: 30_000,
  })
}

export function useRedactionDocumentText(runId: string, enabled = true) {
  return useQuery({ ...redactionDocumentTextQueryOptions(runId), enabled })
}

export function useRetryDetection(runId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<{ run: RedactionRun }>(`/api/redaction-runs/${runId}/retry`, {
        method: 'POST',
      }),
    onSuccess: ({ run }) => {
      client.setQueryData(runKey(runId), run)
      void client.invalidateQueries({ queryKey: runsKey })
    },
  })
}

export function useRedactionOutput(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['redaction-run-output', runId],
    queryFn: () =>
      apiFetch<RedactionOutput>(`/api/redaction-runs/${runId}/output`),
    enabled,
    staleTime: 30_000,
  })
}

export function useRedactionScheduleExport(runId: string) {
  return useMutation({
    mutationFn: (format: 'pdf' | 'docx' | 'json-shareable') =>
      apiFetchBlob(`/api/redaction-runs/${runId}/audit?format=${format}`),
  })
}

export function useRedactionOutputFile(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['redaction-run-output-file', runId],
    queryFn: () => apiFetchBlob(`/api/redaction-runs/${runId}/output/file`),
    enabled,
    staleTime: 60_000,
  })
}

export function useSpanDecision(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ spanId, decision, applyToSameText }: SpanDecisionInput) =>
      apiFetch<{ run: RedactionRun }>(
        `/api/redaction-runs/${runId}/spans/${spanId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            ...(applyToSameText ? { applyToSameText: true } : {}),
          }),
        },
      ),
    onSuccess: ({ run }) => queryClient.setQueryData(runKey(runId), run),
  })
}

export function useRedetectRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<RedetectResponse>(`/api/redaction-runs/${runId}/redetect`, {
        method: 'POST',
      }),
    onSuccess: ({ run }) => {
      queryClient.setQueryData(runKey(run.id), run)
      void queryClient.invalidateQueries({ queryKey: runKey(runId) })
      void queryClient.invalidateQueries({ queryKey: runsKey })
      void queryClient.invalidateQueries({
        queryKey: ['document-redaction-runs'],
      })
    },
  })
}

export function useReturnToDocument(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { baseVersionId: string }) =>
      apiFetch<RedactionReturnResponse>(
        `/api/redaction-runs/${runId}/return-to-document`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: runKey(runId) })
      void queryClient.invalidateQueries({ queryKey: runsKey })
      void queryClient.invalidateQueries({
        queryKey: ['document-redaction-runs'],
      })
      void queryClient.invalidateQueries({
        queryKey: documentsKeys.detail(result.documentId),
      })
    },
  })
}

export function useSaveToMatter(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (matterId: string) =>
      apiFetch<RedactionSaveToMatterResponse>(
        `/api/redaction-runs/${runId}/save-to-matter`,
        { method: 'POST', body: JSON.stringify({ matterId }) },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: runKey(runId) })
      void queryClient.invalidateQueries({ queryKey: runsKey })
      void queryClient.invalidateQueries({
        queryKey: documentsKeys.detail(result.documentId),
      })
    },
  })
}

export function useFinalizeRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: FinalizeInput) =>
      apiFetch<FinalizeResponse>(`/api/redaction-runs/${runId}/finalize`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: ({ run }) => {
      queryClient.setQueryData(runKey(runId), run)
      void queryClient.invalidateQueries({ queryKey: runKey(runId) })
      void queryClient.invalidateQueries({
        queryKey: ['redaction-run-output', runId],
      })
      void queryClient.invalidateQueries({
        queryKey: ['redaction-run-output-file', runId],
      })
      void queryClient.invalidateQueries({ queryKey: runsKey })
      void queryClient.invalidateQueries({
        queryKey: ['document-redaction-runs'],
      })
    },
  })
}
