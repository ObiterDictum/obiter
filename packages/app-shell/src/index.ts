/**
 * @obiter/app-shell public surface. See docs/specs/app-shell/contract.md for the
 * frozen contract (the parts the Redact track builds against).
 */

// Data + auth helpers (contract §3)
export { apiFetch, ApiError } from './api'
export { authClient, useAuth, type UseAuthReturn, type SignInEmailInput } from './auth'
export { currentUserQueryOptions, useCurrentUser } from './current-user'
export { changelogQueryOptions } from './changelog'

// Layout primitives
export { AppShellLayout } from './frame'
export { PageScaffold, type PageScaffoldProps } from './page-scaffold'

// Route views
export { SignInRouteView } from './views/sign-in'
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

// Phase 0 fixture layer (M2 deletes this entire re-export block + fixtures.ts)
export {
  canSeeDevelopmentStatus as canSeeDevelopmentStatusForTest,
  canSeeStaffNavigation as canSeeStaffNavigationForTest,
  createDemoMeResponse,
  createPhaseZeroShellSnapshot,
  findMatterRecord,
  shellSnapshotQueryOptions,
} from './fixtures'
