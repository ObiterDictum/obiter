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

/** True while a listed run is still live, so the caller can poll it. */
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

/**
 * The latest Verify run per document, read through the same per-document
 * boundary and cache entry the document page uses, so a matter overview and
 * an open document never disagree about a run.
 */
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
    // A live run's progress is the page's whole point, so the list re-reads
    // while one is queued or running and stops as soon as none is.
    refetchInterval: (query) =>
      runsAreLive(query.state.data?.pages.flatMap((page) => page.runs))
        ? 2500
        : false,
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

/**
 * Dismiss one finding, or replace the reason on an existing dismissal. The
 * dismissal is stored server-side with the signed-in user and the time; nothing
 * about it is kept client-side. Every verification read is invalidated, so the
 * run's counts, the page and the editor panel agree on the next render.
 */
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

export function latestVerificationRun(runs: VerificationRun[]) {
  return runs[0] ?? null
}

/**
 * What the run list knows about one document. A pending lookup is its own
 * state, not a failure: the run contract carries ids only, so a filename
 * resolves per document and a cold load must not read as unavailable.
 */
export type RunDocumentIdentity =
  | { status: 'pending' }
  | {
      status: 'available'
      filename: string
      /** The version a person would check now, to say which is current. */
      currentVersionId: string | null
      currentVersionNumber: number | undefined
      /** Version id to stored version number, for naming a checked version. */
      versionNumbers: ReadonlyMap<string, number>
      /** True only when the current version can be checked at all. */
      ready: boolean
    }
  | { status: 'unavailable' }

/**
 * The filename and matter of the documents a run list names. The run contract
 * carries ids only and there is no bulk document endpoint, so the shell reads
 * the existing document-detail boundary per distinct document. That keeps the
 * run list's identity on the same source of truth as the document route
 * instead of adding a second document projection to the API.
 */
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
