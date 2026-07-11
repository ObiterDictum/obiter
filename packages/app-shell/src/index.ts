/**
 * @obiter/app-shell public surface. See docs/specs/app-shell/contract.md for the
 * frozen contract (the parts the Redact track builds against).
 */

// Data + auth helpers (contract §3)
export { apiFetch, ApiError } from './api'
export { authClient, useAuth, type UseAuthReturn, type SignInEmailInput } from './auth'
export {
  currentUserQueryOptions,
  useCurrentUser,
  createOrganisationMutationOptions,
  useCreateOrganisation,
  type CreateOrganisationResult,
} from './current-user'
export { changelogQueryOptions } from './changelog'
export { guardAuth, ensureOrganisation } from './route-loaders'

// Live-surface data (M2): real matters + documents via TanStack Query.
export {
  mattersListQueryOptions,
  matterQueryOptions,
  mattersKeys,
  useMattersList,
  useMatter,
  useCreateMatter,
  type MatterRecord,
  type MatterStatus,
  type CreateMatterInput,
} from './matters'
export {
  matterDocumentsQueryOptions,
  documentQueryOptions,
  documentsKeys,
  useMatterDocuments,
  useDocument,
  type MatterDocumentRecord,
  type DocumentVersionRecord,
  type DocumentStatus,
  type SyncState,
} from './documents'

// Layout primitives
export { AppShellLayout } from './frame'
export { PageScaffold, type PageScaffoldProps } from './page-scaffold'

// Route views
export { SignInRouteView } from './views/sign-in'
export { ForgotPasswordRouteView } from './views/forgot-password'
export { ResetPasswordRouteView } from './views/reset-password'
export { HomeRouteView } from './views/home'
export { MattersRouteView, MatterRouteView } from './views/matters'
export { DocumentDetailLayoutView } from './views/document-detail'

// Search surfaces (M3 restyle; logic unchanged)
export {
  CaseLawDocumentView,
  caseLawDocumentQueryOptions,
} from './views/CaseLawDocumentView'
export {
  LegalSearchView,
  LEGAL_SEARCH_DEBOUNCE_MS,
  LEGAL_SEARCH_RECENT_SEARCHES_LIMIT,
  courtOptionGroups,
  countActiveLegalSearchFilters,
  createLegalSearchFetchRequest,
  getCourtLabel,
  getLegalSearchEmptyFeedback,
  getRecentLegalSearches,
  getLegalSearchStateAfterInputChange,
  getLegalSearchStateLabel,
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
  shouldRunLegalSearch,
  shouldRunLegalSearchRequest,
  writeRecentLegalSearch,
} from './views/LegalSearchView'
