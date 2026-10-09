/**
 * The document workspace's API surface, re-exported from its owners so the
 * module specifier stays stable for components and test mocks:
 * reads live in `document-workspace-queries`, writes in
 * `document-workspace-mutations`, and binary fetches in
 * `document-workspace-downloads`.
 */
export {
  workspaceKeys,
  versionQuery,
  documentModelQueryOptions,
  documentPdfViewQueryOptions,
  documentTextQueryOptions,
  documentCompareQueryOptions,
  documentCommentsQueryOptions,
  documentTrackedChangesQueryOptions,
  documentCollaborationSyncQueryOptions,
  useDocumentModel,
  useDocumentPdfView,
  useDocumentText,
  useDocumentCompare,
  useDocumentComments,
  useDocumentTrackedChanges,
  useDocumentCollaborationSync,
} from './document-workspace-queries'
export {
  useCreateDocumentComment,
  useReplyDocumentComment,
  useResolveDocumentComment,
  useReopenDocumentComment,
  useEditDocument,
  useUpdateDocumentMarkings,
  useTrackedChangeDecision,
  useCollaborationMerge,
  usePresenceUpdate,
} from './document-workspace-mutations'
export {
  useDocumentImageUrls,
  fetchDocumentExport,
  contentDispositionFilename,
  fetchDocumentDownload,
} from './document-workspace-downloads'
