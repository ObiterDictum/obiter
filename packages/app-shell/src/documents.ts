import { useQuery } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

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
  currentVersion?: DocumentVersionRecord | null
}

interface MatterDocumentsResponse {
  documents: MatterDocumentRecord[]
}

export interface DocumentDetailResponse {
  document: MatterDocumentRecord
  versions: DocumentVersionRecord[]
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
