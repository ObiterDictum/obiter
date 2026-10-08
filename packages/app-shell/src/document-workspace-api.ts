import {
  useMutation,
  useQuery,
  useQueryClient,
  useQueries,
} from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type {
  DocumentCollaborationMergeRequest,
  DocumentCollaborationMergeResponse,
  DocumentCollaborationSyncResponse,
  DocumentCommentCreateRequest,
  DocumentCommentCreateResponse,
  DocumentCommentListResponse,
  DocumentCommentReopenResponse,
  DocumentCommentReplyCreateRequest,
  DocumentCommentReplyCreateResponse,
  DocumentCommentResolveResponse,
  DocumentCompareResponse,
  DocumentEditRequest,
  DocumentEditResponse,
  DocumentModelResponse,
  DocumentPdfViewResponse,
  DocumentPresenceUpdateRequest,
  DocumentTextResponse,
  DocumentTrackedChangeDecisionRequest,
  DocumentTrackedChangeListResponse,
} from '@obiter/contracts'
import { apiFetch, apiFetchBlob, apiFetchBlobResult } from './api'
import { documentsKeys } from './documents'

// A historical version's reads are cached under the version id, never under
// the current key — a selected version must not render cached current content
// nor leak its own content into the current view.
const CURRENT_VERSION_KEY = 'current'

export const workspaceKeys = {
  model: (documentId: string, versionId?: string) =>
    [
      ...documentsKeys.all,
      'model',
      documentId,
      versionId ?? CURRENT_VERSION_KEY,
    ] as const,
  pdfView: (documentId: string, versionId?: string) =>
    [
      ...documentsKeys.all,
      'pdf-view',
      documentId,
      versionId ?? CURRENT_VERSION_KEY,
    ] as const,
  text: (documentId: string, versionId?: string) =>
    [
      ...documentsKeys.all,
      'text',
      documentId,
      versionId ?? CURRENT_VERSION_KEY,
    ] as const,
  comments: (documentId: string) =>
    [...documentsKeys.all, 'comments', documentId] as const,
  trackedChanges: (documentId: string, versionId?: string) =>
    [
      ...documentsKeys.all,
      'tracked-changes',
      documentId,
      versionId ?? CURRENT_VERSION_KEY,
    ] as const,
  sync: (documentId: string) =>
    [...documentsKeys.all, 'collaboration-sync', documentId] as const,
  media: (documentId: string, versionId?: string) =>
    [
      ...documentsKeys.all,
      'media',
      documentId,
      versionId ?? CURRENT_VERSION_KEY,
    ] as const,
  compare: (documentId: string) =>
    [...documentsKeys.all, 'compare', documentId] as const,
}

/** The `?versionId=` selector the version-aware read routes share. */
function versionQuery(versionId: string | undefined) {
  return versionId === undefined
    ? ''
    : `?versionId=${encodeURIComponent(versionId)}`
}

export function documentModelQueryOptions(
  documentId: string,
  versionId?: string,
) {
  return queryOptions({
    queryKey: workspaceKeys.model(documentId, versionId),
    queryFn: () =>
      apiFetch<DocumentModelResponse>(
        `/api/documents/${documentId}/model${versionQuery(versionId)}`,
      ),
  })
}

export function documentPdfViewQueryOptions(
  documentId: string,
  versionId?: string,
) {
  return queryOptions({
    queryKey: workspaceKeys.pdfView(documentId, versionId),
    queryFn: () =>
      apiFetch<DocumentPdfViewResponse>(
        `/api/documents/${documentId}/pdf-view${versionQuery(versionId)}`,
      ),
  })
}

export function documentTextQueryOptions(
  documentId: string,
  versionId?: string,
) {
  return queryOptions({
    queryKey: workspaceKeys.text(documentId, versionId),
    queryFn: () =>
      apiFetch<DocumentTextResponse>(
        `/api/documents/${documentId}/text${versionQuery(versionId)}`,
      ),
  })
}

export function documentCompareQueryOptions(
  documentId: string,
  baseVersionId: string,
  targetVersionId: string,
) {
  const search =
    `?baseVersionId=${encodeURIComponent(baseVersionId)}` +
    `&targetVersionId=${encodeURIComponent(targetVersionId)}`
  return queryOptions({
    queryKey: [
      ...workspaceKeys.compare(documentId),
      baseVersionId,
      targetVersionId,
    ] as const,
    queryFn: () =>
      apiFetch<DocumentCompareResponse>(
        `/api/documents/${documentId}/compare${search}`,
      ),
  })
}

export function documentCommentsQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: workspaceKeys.comments(documentId),
    queryFn: () =>
      apiFetch<DocumentCommentListResponse>(
        `/api/documents/${documentId}/comments`,
      ),
  })
}

export function documentTrackedChangesQueryOptions(
  documentId: string,
  versionId?: string,
) {
  return queryOptions({
    queryKey: workspaceKeys.trackedChanges(documentId, versionId),
    queryFn: () =>
      apiFetch<DocumentTrackedChangeListResponse>(
        `/api/documents/${documentId}/tracked-changes${versionQuery(versionId)}`,
      ),
  })
}

export function documentCollaborationSyncQueryOptions(
  documentId: string,
  sinceVersionId: string | undefined,
) {
  const search =
    sinceVersionId === undefined
      ? ''
      : `?sinceVersionId=${encodeURIComponent(sinceVersionId)}`
  return queryOptions({
    queryKey: [
      ...workspaceKeys.sync(documentId),
      sinceVersionId ?? '',
    ] as const,
    queryFn: () =>
      apiFetch<DocumentCollaborationSyncResponse>(
        `/api/documents/${documentId}/collaboration/sync${search}`,
      ),
    refetchInterval: 2_000,
  })
}

export function useDocumentImageUrls(
  documentId: string,
  partNames: string[],
  versionId?: string,
) {
  const queries = useQueries({
    queries: partNames.map((partName) => ({
      queryKey: [...workspaceKeys.media(documentId, versionId), partName],
      queryFn: () => loadDocumentImage(documentId, partName, versionId),
      gcTime: 0,
    })),
  })
  const urls: Record<string, string> = {}
  partNames.forEach((partName, index) => {
    const url = queries[index]?.data
    if (url) urls[partName] = url
  })
  const held = useRef<Record<string, string>>({})
  const signature = partNames
    .map((partName) => `${partName}=${urls[partName] ?? ''}`)
    .join('|')
  // Revoke blob URLs that are no longer used; keep URLs whose part is unchanged.
  useEffect(() => {
    const next = { ...urls }
    for (const [partName, url] of Object.entries(held.current)) {
      if (next[partName] !== url) URL.revokeObjectURL(url)
    }
    held.current = next
  }, [signature])
  useEffect(() => {
    return () => {
      for (const url of Object.values(held.current)) URL.revokeObjectURL(url)
      held.current = {}
    }
  }, [documentId])
  return urls
}

const BROWSER_IMAGE = /^image\/(png|jpeg|gif|bmp|webp|svg\+xml)$/

/**
 * Media parts are fetched as bytes and rendered from a blob URL, never by
 * pointing an element at the API URL. The media endpoint serves stored
 * document parts as `Content-Disposition: attachment` under a `sandbox` CSP,
 * so navigating that URL downloads rather than renders. Keeping the fetch here
 * preserves display; setting `src` to the API path directly would break the
 * image, and reverting the endpoint to inline would re-open stored XSS.
 *
 * SVG is allowed through because an `<img>` never executes script in an SVG it
 * loads. Do not move these bytes into an `<object>`, `<embed>`, `<iframe>` or
 * `innerHTML`, all of which do.
 */
async function loadDocumentImage(
  documentId: string,
  partName: string,
  versionId?: string,
) {
  const search = `?part=${encodeURIComponent(partName)}${
    versionId === undefined ? '' : `&versionId=${encodeURIComponent(versionId)}`
  }`
  const blob = await apiFetchBlob(`/api/documents/${documentId}/media${search}`)
  if (!BROWSER_IMAGE.test(blob.type)) return null
  return URL.createObjectURL(blob)
}

export async function fetchDocumentExport(
  documentId: string,
  versionId?: string,
): Promise<{ blob: Blob; skippedCommentCount: number }> {
  const search =
    versionId === undefined ? '' : `?versionId=${encodeURIComponent(versionId)}`
  const { blob, headers } = await apiFetchBlobResult(
    `/api/documents/${documentId}/export${search}`,
  )
  const skipped = Number(headers.get('x-obiter-comments-skipped') ?? '0')
  return { blob, skippedCommentCount: Number.isFinite(skipped) ? skipped : 0 }
}

/** Raw source bytes for any ready version: the download path behind every viewer. */
export async function fetchDocumentDownload(
  documentId: string,
  versionId?: string,
): Promise<Blob> {
  return apiFetchBlob(
    `/api/documents/${documentId}/download${versionQuery(versionId)}`,
  )
}

export function useDocumentModel(
  documentId: string,
  options?: { enabled?: boolean; versionId?: string },
) {
  return useQuery({
    ...documentModelQueryOptions(documentId, options?.versionId),
    enabled: options?.enabled ?? true,
  })
}

export function useDocumentPdfView(
  documentId: string,
  options?: { enabled?: boolean; versionId?: string },
) {
  return useQuery({
    ...documentPdfViewQueryOptions(documentId, options?.versionId),
    enabled: options?.enabled ?? true,
  })
}

export function useDocumentText(
  documentId: string,
  options?: { enabled?: boolean; versionId?: string },
) {
  return useQuery({
    ...documentTextQueryOptions(documentId, options?.versionId),
    enabled: options?.enabled ?? true,
  })
}

export function useDocumentCompare(
  documentId: string,
  baseVersionId: string | undefined,
  targetVersionId: string | undefined,
) {
  return useQuery({
    ...documentCompareQueryOptions(
      documentId,
      baseVersionId ?? '',
      targetVersionId ?? '',
    ),
    // The pair is only fetched once both sides are picked; '' never reaches
    // the API because a disabled query never runs its queryFn.
    enabled: baseVersionId !== undefined && targetVersionId !== undefined,
  })
}

export function useDocumentComments(
  documentId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...documentCommentsQueryOptions(documentId),
    enabled: options?.enabled ?? true,
  })
}

export function useDocumentTrackedChanges(
  documentId: string,
  options?: { enabled?: boolean; versionId?: string },
) {
  return useQuery({
    ...documentTrackedChangesQueryOptions(documentId, options?.versionId),
    enabled: options?.enabled ?? true,
  })
}

export function useDocumentCollaborationSync(
  documentId: string,
  sinceVersionId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...documentCollaborationSyncQueryOptions(documentId, sinceVersionId),
    enabled: options?.enabled ?? true,
  })
}

function invalidateWorkspace(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
  matterId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: documentsKeys.detail(documentId),
    }),
    queryClient.invalidateQueries({
      queryKey: documentsKeys.byMatter(matterId),
    }),
    queryClient.invalidateQueries({
      queryKey: workspaceKeys.model(documentId),
    }),
    queryClient.invalidateQueries({
      queryKey: workspaceKeys.comments(documentId),
    }),
    queryClient.invalidateQueries({
      queryKey: workspaceKeys.trackedChanges(documentId),
    }),
    queryClient.invalidateQueries({ queryKey: workspaceKeys.sync(documentId) }),
  ])
}

export function useCreateDocumentComment(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentCommentCreateRequest) =>
      apiFetch<DocumentCommentCreateResponse>(
        `/api/documents/${documentId}/comments`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.comments(documentId),
      }),
  })
}

export function useReplyDocumentComment(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // `commentId` is either a product `cmt_` id or an imported `ooxml-` thread
    // head; the route tells them apart by prefix.
    mutationFn: (input: {
      commentId: string
      reply: DocumentCommentReplyCreateRequest
    }) =>
      apiFetch<DocumentCommentReplyCreateResponse>(
        `/api/documents/${documentId}/comments/${input.commentId}/replies`,
        { method: 'POST', body: JSON.stringify(input.reply) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.comments(documentId),
      }),
  })
}

export function useResolveDocumentComment(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<DocumentCommentResolveResponse>(
        `/api/documents/${documentId}/comments/${commentId}/resolve`,
        { method: 'PATCH', body: JSON.stringify({}) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.comments(documentId),
      }),
  })
}

export function useReopenDocumentComment(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<DocumentCommentReopenResponse>(
        `/api/documents/${documentId}/comments/${commentId}/reopen`,
        { method: 'PATCH', body: JSON.stringify({}) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.comments(documentId),
      }),
  })
}

export function useEditDocument(documentId: string, matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentEditRequest) =>
      apiFetch<DocumentEditResponse>(`/api/documents/${documentId}/edit`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateWorkspace(queryClient, documentId, matterId),
  })
}

export function useTrackedChangeDecision(documentId: string, matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentTrackedChangeDecisionRequest) =>
      apiFetch<DocumentEditResponse>(
        `/api/documents/${documentId}/tracked-changes/decision`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => invalidateWorkspace(queryClient, documentId, matterId),
  })
}

export function useCollaborationMerge(documentId: string, matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentCollaborationMergeRequest) =>
      apiFetch<DocumentCollaborationMergeResponse>(
        `/api/documents/${documentId}/collaboration/merge`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => invalidateWorkspace(queryClient, documentId, matterId),
  })
}

export function usePresenceUpdate(documentId: string) {
  return useMutation({
    mutationFn: (input: DocumentPresenceUpdateRequest) =>
      apiFetch(`/api/documents/${documentId}/collaboration/presence`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
  })
}
