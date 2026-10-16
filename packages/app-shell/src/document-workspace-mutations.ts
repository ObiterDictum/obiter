import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  DocumentCollaborationMergeRequest,
  DocumentCollaborationMergeResponse,
  DocumentCommentCreateRequest,
  DocumentCommentCreateResponse,
  DocumentCommentReopenResponse,
  DocumentCommentReplyCreateRequest,
  DocumentCommentReplyCreateResponse,
  DocumentCommentResolveResponse,
  DocumentEditRequest,
  DocumentEditResponse,
  DocumentMarkingsRequest,
  DocumentMarkingsResponse,
  DocumentPresenceUpdateRequest,
  DocumentTrackedChangeDecisionRequest,
} from '@obiter/contracts'
import { apiFetch } from './api'
import { documentsKeys } from './documents'
import { workspaceKeys } from './document-workspace-queries'

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

export function useUpdateDocumentMarkings(
  documentId: string,
  matterId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentMarkingsRequest) =>
      apiFetch<DocumentMarkingsResponse>(
        `/api/documents/${documentId}/markings`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
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
