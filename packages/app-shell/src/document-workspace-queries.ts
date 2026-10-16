import { queryOptions, useQuery } from '@tanstack/react-query'
import type {
  DocumentCollaborationSyncResponse,
  DocumentCommentListResponse,
  DocumentCompareResponse,
  DocumentModelResponse,
  DocumentPdfViewResponse,
  DocumentTextResponse,
  DocumentTrackedChangeListResponse,
} from '@obiter/contracts'
import { apiFetch } from './api'
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
export function versionQuery(versionId: string | undefined) {
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
