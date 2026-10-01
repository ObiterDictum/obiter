import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useMemo } from 'react'
import type {
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

/**
 * The organisation run list is keyset-paginated, so it is an infinite query:
 * the first page loads with the view and each continuation is an explicit,
 * accessible "Load more" action rather than an unbounded response.
 */
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
  })
  // Flattened once per page state: a new array every render would make every
  // consumer of the list look like it changed, and measurement effects keyed on
  // that list would re-run forever.
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

export function latestVerificationRun(runs: VerificationRun[]) {
  return runs[0] ?? null
}

/**
 * The filename and matter of the documents a run list names. The run contract
 * carries ids only and there is no bulk document endpoint, so the shell reads
 * the existing document-detail boundary per distinct document. That keeps the
 * run list's identity on the same source of truth as the document route
 * instead of adding a second document projection to the API.
 */
export function useVerificationRunDocuments(runs: VerificationRun[]) {
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
  const identities = new Map<string, string>()
  documentIds.forEach((documentId, index) => {
    const document = queries[index]?.data?.document
    if (!document) return
    identities.set(
      documentId,
      document.currentVersion?.filename ?? document.logicalKey,
    )
  })
  return identities
}
