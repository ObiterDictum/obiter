import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'
import { declaredFileType } from './file-type'

/**
 * Real document domain types, mirroring the wire shapes returned by the
 * documents API (metadata-only: filename, hash, size, version, status — no file
 * bytes are ever received or stored).
 */

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
  createdAt: string
  updatedAt: string
}

export interface MatterDocumentRecord {
  id: string
  organisationId: string
  matterId: string
  currentVersionId: string | null
  logicalKey: string
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

/** Query key factory for documents. */
export const documentsKeys = {
  all: ['documents'] as const,
  byMatter: (matterId: string) =>
    [...documentsKeys.all, 'matter', matterId] as const,
  detail: (documentId: string) =>
    [...documentsKeys.all, 'detail', documentId] as const,
}

/** Documents list for a matter (metadata only). */
export function matterDocumentsQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: documentsKeys.byMatter(matterId),
    queryFn: async () => {
      const response = await apiFetch<MatterDocumentsResponse>(
        `/api/matters/${matterId}/documents`,
      )
      return response.documents
    },
  })
}

/** A single document with all its versions. */
export function documentQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: documentsKeys.detail(documentId),
    queryFn: async () =>
      apiFetch<DocumentDetailResponse>(`/api/documents/${documentId}`),
  })
}

export function useMatterDocuments(matterId: string) {
  return useQuery(matterDocumentsQueryOptions(matterId))
}

export function useDocument(documentId: string) {
  return useQuery(documentQueryOptions(documentId))
}

export function useUploadMatterDocument(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.set('file', file)
      form.set('fileType', declaredFileType(file))
      return apiFetch<DocumentUploadResponse>(
        `/api/matters/${matterId}/documents`,
        { method: 'POST', body: form },
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: documentsKeys.byMatter(matterId),
      }),
  })
}

/**
 * Soft-delete a document and its redaction runs (owner/admin only). On success
 * the detail is removed from cache and the parent matter's document list is
 * invalidated so the document disappears on next read.
 */
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
