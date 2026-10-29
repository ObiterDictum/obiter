import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useMemo } from 'react'
import type {
  VerificationFindingDismissResponse,
  VerificationFindingsResponse,
  VerificationRun,
  VerificationRunListResponse,
  VerificationRunResponse,
} from '@obiter/contracts'
import { apiFetch } from './api'
import { documentQueryOptions } from './documents'

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

function pageQuery(cursor: string | null) {
  return cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
}

function runsAreLive(runs: readonly VerificationRun[] | undefined) {
  return (
    runs?.some((run) => run.status === 'queued' || run.status === 'running') ??
    false
  )
}

function documentVerificationRunsQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: documentVerificationRunsQueryKey(documentId),
    queryFn: () =>
      apiFetch<VerificationRunListResponse>(
        `/api/documents/${documentId}/verification-runs`,
      ),
    refetchInterval: (query) =>
      runsAreLive(query.state.data?.runs) ? 1500 : false,
  })
}

export function useDocumentVerificationRuns(documentId: string) {
  return useQuery(documentVerificationRunsQueryOptions(documentId))
}

export type DocumentVerificationState =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'loaded'; run: VerificationRun | null }

export function useLatestVerificationRuns(
  documentIds: string[],
): Map<string, DocumentVerificationState> {
  const queries = useQueries({
    queries: documentIds.map(documentVerificationRunsQueryOptions),
  })
  const states = new Map<string, DocumentVerificationState>()
  documentIds.forEach((documentId, index) => {
    const query = queries[index]
    if (!query || query.isPending) states.set(documentId, { status: 'pending' })
    else if (query.isError) states.set(documentId, { status: 'unavailable' })
    else
      states.set(documentId, {
        status: 'loaded',
        run: latestVerificationRun(query.data.runs),
      })
  })
  return states
}

export function useOrganisationVerificationRuns(enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: verificationRunsQueryKey,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      apiFetch<VerificationRunListResponse>(
        `/api/verification-runs${pageQuery(pageParam)}`,
      ),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 15_000,
    refetchInterval: (query) =>
      runsAreLive(query.state.data?.pages.flatMap((page) => page.runs))
        ? 2500
        : false,
  })
  const runs = useMemo(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  )
  return { ...query, runs }
}

export function useVerificationFindings(runId: string | null) {
  const query = useInfiniteQuery({
    queryKey: verificationFindingsQueryKey(runId ?? ''),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      apiFetch<VerificationFindingsResponse>(
        `/api/verification-runs/${runId}/findings${pageQuery(pageParam)}`,
      ),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: runId != null,
  })
  const findings = useMemo(
    () => query.data?.pages.flatMap((page) => page.findings) ?? [],
    [query.data],
  )
  return { ...query, findings }
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

export function useDismissVerificationFinding(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { findingId: string; reason: string | null }) =>
      apiFetch<VerificationFindingDismissResponse>(
        `/api/verification-runs/${runId}/findings/${encodeURIComponent(input.findingId)}/dismiss`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.reason ? { reason: input.reason } : {}),
        },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: verificationRunsQueryKey }),
  })
}

export function useUndismissVerificationFinding(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (findingId: string) =>
      apiFetch<void>(
        `/api/verification-runs/${runId}/findings/${encodeURIComponent(findingId)}/dismiss`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: verificationRunsQueryKey }),
  })
}

export function latestVerificationRun(runs: VerificationRun[]) {
  return runs[0] ?? null
}

export type RunDocumentIdentity =
  | { status: 'pending' }
  | {
      status: 'available'
      filename: string
      currentVersionId: string | null
      currentVersionNumber: number | undefined
      versionNumbers: ReadonlyMap<string, number>
      ready: boolean
    }
  | { status: 'unavailable' }

export function useVerificationRunDocuments(
  runs: VerificationRun[],
): Map<string, RunDocumentIdentity> {
  const documentIds = useMemo(
    () => [...new Set(runs.map((run) => run.documentId))],
    [runs],
  )
  const queries = useQueries({
    queries: documentIds.map((documentId) => ({
      ...documentQueryOptions(documentId),
      staleTime: 30_000,
    })),
  })
  const identities = new Map<string, RunDocumentIdentity>()
  documentIds.forEach((documentId, index) => {
    const query = queries[index]
    if (!query || query.isPending) {
      identities.set(documentId, { status: 'pending' })
      return
    }
    const document = query.data?.document
    if (!document) {
      identities.set(documentId, { status: 'unavailable' })
      return
    }
    const currentVersionId =
      document.currentVersionId ?? document.currentVersion?.id ?? null
    const versions = query.data?.versions ?? []
    identities.set(documentId, {
      status: 'available',
      filename: document.currentVersion?.filename ?? document.logicalKey,
      currentVersionId,
      currentVersionNumber: versions.find(
        (version) => version.id === currentVersionId,
      )?.versionNumber,
      versionNumbers: new Map(
        versions.map((version) => [version.id, version.versionNumber]),
      ),
      ready: document.currentVersion?.documentStatus === 'ready',
    })
  })
  return identities
}
