import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  VerificationFindingsResponse,
  VerificationRun,
  VerificationRunListResponse,
  VerificationRunResponse,
} from '@obiter/contracts'
import { apiFetch } from './api'

export const verificationRunsQueryKey = ['verification-runs'] as const

export function documentVerificationRunsQueryKey(documentId: string) {
  return [...verificationRunsQueryKey, 'document', documentId] as const
}

export function verificationRunQueryKey(runId: string) {
  return [...verificationRunsQueryKey, 'run', runId] as const
}

export function verificationFindingsQueryKey(runId: string) {
  return [...verificationRunsQueryKey, 'findings', runId] as const
}

export function useDocumentVerificationRuns(documentId: string) {
  return useQuery({
    queryKey: documentVerificationRunsQueryKey(documentId),
    queryFn: () =>
      apiFetch<VerificationRunListResponse>(
        `/api/documents/${documentId}/verification-runs`,
      ),
    refetchInterval: (query) =>
      query.state.data?.runs.some(
        (run) => run.status === 'queued' || run.status === 'running',
      )
        ? 1500
        : false,
  })
}

export function useOrganisationVerificationRuns(enabled: boolean) {
  return useQuery({
    queryKey: verificationRunsQueryKey,
    queryFn: () =>
      apiFetch<VerificationRunListResponse>('/api/verification-runs'),
    enabled,
    staleTime: 15_000,
  })
}

export function useVerificationFindings(runId: string | null) {
  return useQuery({
    queryKey: verificationFindingsQueryKey(runId ?? ''),
    queryFn: () =>
      apiFetch<VerificationFindingsResponse>(
        `/api/verification-runs/${runId}/findings`,
      ),
    enabled: runId != null,
  })
}

export function useCreateVerificationRun(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string) =>
      apiFetch<VerificationRunResponse>(
        `/api/documents/${documentId}/verification-runs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ versionId }),
        },
      ),
    onSuccess: async (payload) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: documentVerificationRunsQueryKey(documentId),
        }),
        queryClient.invalidateQueries({ queryKey: verificationRunsQueryKey }),
        queryClient.setQueryData(
          verificationRunQueryKey(payload.run.id),
          payload,
        ),
      ])
    },
  })
}

export function latestVerificationRun(runs: VerificationRun[]) {
  return runs[0] ?? null
}
