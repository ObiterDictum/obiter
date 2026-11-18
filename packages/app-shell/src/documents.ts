import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { useEffect } from 'react'
import type {
  CitationTargetsResponse,
  DocumentRenameResponse,
  DocumentOpenResponse,
  PersonAttribution,
  RecentlyOpenedDocumentResponse,
} from '@obiter/contracts'
import { apiFetch, ApiError } from './api'
import { useSignedIn } from './auth'
import { declaredFileType } from './file-type'

export type DocumentStatus =
  'queued' | 'processing' | 'ready' | 'failed' | 'needs_review'

export type SyncState =
  'local_only' | 'queued' | 'syncing' | 'synced' | 'conflict' | 'failed'

export interface DocumentVersionRecord {
  id: string
  organisationId: string
  matterId: string
  matterDocumentId: string
  filename: string
  fileType: string
  sizeBytes: string
  objectKey: string
  textObjectKey: string | null
  documentStatus: DocumentStatus
  failureReason: string | null
  versionNumber: number
  contentSha256: string
  syncState: SyncState
  createdBy: string
  author?: PersonAttribution | null
  createdAt: string
  updatedAt: string
  redaction?: VersionRedaction | null
}

export interface VersionRedaction {
  runId: string
  producedBy: string | null
  canOpen: boolean
}

export interface MatterDocumentRecord {
  id: string
  organisationId: string
  matterId: string
  currentVersionId: string | null
  logicalKey: string
  name?: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
  currentVersion?: DocumentVersionRecord | null
}

interface MatterDocumentsResponse {
  documents: MatterDocumentRecord[]
}

export interface DocumentDetailResponse {
  document: MatterDocumentRecord
  versions: DocumentVersionRecord[]
}

export interface DocumentUploadResponse {
  document: MatterDocumentRecord
  version: DocumentVersionRecord
}

export const documentsKeys = {
  all: ['documents'] as const,
  byMatter: (matterId: string) =>
    [...documentsKeys.all, 'matter', matterId] as const,
  detail: (documentId: string) =>
    [...documentsKeys.all, 'detail', documentId] as const,
  recentlyOpened: () => [...documentsKeys.all, 'recently-opened'] as const,
  citationTargets: () => [...documentsKeys.all, 'citation-targets'] as const,
}

export function documentsNeedStatusPoll(
  documents: MatterDocumentRecord[] | undefined,
): boolean {
  return Boolean(
    documents?.some((document) => {
      const status = document.currentVersion?.documentStatus
      return status === 'queued' || status === 'processing'
    }),
  )
}

export function matterDocumentsQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: documentsKeys.byMatter(matterId),
    queryFn: async () => {
      const response = await apiFetch<MatterDocumentsResponse>(
        `/api/matters/${matterId}/documents`,
      )
      return response.documents
    },
    refetchInterval: (query) =>
      documentsNeedStatusPoll(query.state.data) ? 2_000 : false,
  })
}

export function retryDocumentLookup(failureCount: number, error: Error) {
  if (error instanceof ApiError && error.status === 404) return false
  return failureCount < 3
}

export function documentQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: documentsKeys.detail(documentId),
    queryFn: async () =>
      apiFetch<DocumentDetailResponse>(`/api/documents/${documentId}`),
    retry: retryDocumentLookup,
  })
}

export function recentlyOpenedDocumentQueryOptions() {
  return queryOptions({
    queryKey: documentsKeys.recentlyOpened(),
    queryFn: async () => {
      const response = await apiFetch<RecentlyOpenedDocumentResponse>(
        '/api/documents/recently-opened',
      )
      return response.document
    },
    staleTime: 30_000,
  })
}

export function useRecentlyOpenedDocument(options?: { enabled?: boolean }) {
  return useQuery({
    ...recentlyOpenedDocumentQueryOptions(),
    enabled: options?.enabled ?? true,
  })
}

export function citationTargetsQueryOptions() {
  return queryOptions({
    queryKey: documentsKeys.citationTargets(),
    queryFn: async () => {
      const response = await apiFetch<CitationTargetsResponse>(
        '/api/documents/citation-targets',
      )
      return response.documents
    },
    staleTime: 30_000,
  })
}

export function useCitationTargets() {
  return useQuery({
    ...citationTargetsQueryOptions(),
    enabled: useSignedIn(),
  })
}

export function useRecordDocumentOpen(documentId: string) {
  const queryClient = useQueryClient()
  const { mutate } = useMutation({
    mutationFn: (id: string) =>
      apiFetch<DocumentOpenResponse>(`/api/documents/${id}/opened`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: documentsKeys.recentlyOpened(),
      })
      void queryClient.invalidateQueries({
        queryKey: documentsKeys.citationTargets(),
      })
    },
  })

  useEffect(() => {
    mutate(documentId)
  }, [documentId, mutate])
}

export function useMatterDocuments(
  matterId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...matterDocumentsQueryOptions(matterId),
    enabled: options?.enabled ?? true,
  })
}

export function useDocument(
  documentId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...documentQueryOptions(documentId),
    enabled: options?.enabled ?? true,
  })
}

export function uploadMatterDocumentRequest(matterId: string, file: File) {
  const form = new FormData()
  form.set('file', file)
  form.set('fileType', declaredFileType(file))
  return apiFetch<DocumentUploadResponse>(
    `/api/matters/${matterId}/documents`,
    { method: 'POST', body: form },
  )
}

export function useUploadMatterDocument(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadMatterDocumentRequest(matterId, file),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: documentsKeys.byMatter(matterId),
      }),
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { documentId: string; matterId: string }) => {
      await apiFetch(`/api/documents/${input.documentId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: async (_data, { documentId, matterId }) => {
      queryClient.removeQueries({ queryKey: documentsKeys.detail(documentId) })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: documentsKeys.byMatter(matterId),
        }),
        queryClient.invalidateQueries({ queryKey: ['redaction-runs'] }),
        queryClient.invalidateQueries({
          queryKey: ['document-redaction-runs'],
        }),
      ])
    },
  })
}

export function documentDisplayName(
  document: Pick<
    MatterDocumentRecord,
    'name' | 'logicalKey' | 'currentVersion'
  >,
  version?: Pick<DocumentVersionRecord, 'filename' | 'fileType'> | null,
) {
  const shown = version ?? document.currentVersion
  if (document.name && shown) return `${document.name}.${shown.fileType}`
  return document.name ?? shown?.filename ?? document.logicalKey
}

export function documentFilename(
  document: Pick<MatterDocumentRecord, 'name'> | undefined,
  version: Pick<DocumentVersionRecord, 'filename' | 'fileType'>,
) {
  return document?.name
    ? `${document.name}.${version.fileType}`
    : version.filename
}

export function documentRenameErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 404) {
    return 'This document could not be renamed. It may have been deleted, or you may not have edit access to this matter.'
  }
  if (error instanceof ApiError && error.status === 400) return error.message
  return 'The document could not be renamed. Check your connection and try again.'
}

export function useRenameDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      documentId: string
      matterId: string
      name: string
    }) => {
      const response = await apiFetch<DocumentRenameResponse>(
        `/api/documents/${input.documentId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: input.name }),
        },
      )
      return response.document
    },
    onSuccess: async (renamed, { matterId }) => {
      const apply = (document: MatterDocumentRecord) =>
        document.id === renamed.id
          ? { ...document, name: renamed.name, updatedAt: renamed.updatedAt }
          : document
      queryClient.setQueryData<DocumentDetailResponse>(
        documentsKeys.detail(renamed.id),
        (previous) =>
          previous
            ? { ...previous, document: apply(previous.document) }
            : previous,
      )
      queryClient.setQueryData<MatterDocumentRecord[]>(
        documentsKeys.byMatter(matterId),
        (previous) => previous?.map(apply),
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: documentsKeys.recentlyOpened(),
        }),
        queryClient.invalidateQueries({
          queryKey: documentsKeys.citationTargets(),
        }),
      ])
    },
  })
}
