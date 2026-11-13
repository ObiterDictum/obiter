export { apiFetch, apiFetchBlob, ApiError } from './api'
export {
  setServerRequestGetter,
  getServerRequest,
  clearServerRequestGetter,
} from './lib/server-request'
export { declaredFileType } from './file-type'
export {
  authClient,
  useAuth,
  type UseAuthReturn,
  type SignInEmailInput,
} from './auth'
export {
  currentUserQueryOptions,
  useCurrentUser,
  createOrganisationMutationOptions,
  useCreateOrganisation,
  type CreateOrganisationResult,
} from './current-user'
export {
  guardAuth,
  prefetchHomeData,
  prefetchInviteAcceptData,
  prefetchVerifyData,
} from './route-loaders'

export {
  mattersListQueryOptions,
  matterQueryOptions,
  mattersKeys,
  useMattersList,
  useMatter,
  useCreateMatter,
  useDeleteMatter,
  type MatterRecord,
  type MatterStatus,
  type CreateMatterInput,
} from './matters'
export {
  matterDocumentsQueryOptions,
  documentQueryOptions,
  documentsKeys,
  recentlyOpenedDocumentQueryOptions,
  useRecentlyOpenedDocument,
  useRecordDocumentOpen,
  useMatterDocuments,
  useDocument,
  useUploadMatterDocument,
  useDeleteDocument,
  type MatterDocumentRecord,
  type DocumentVersionRecord,
  type DocumentUploadResponse,
  type DocumentStatus,
  type SyncState,
} from './documents'

export { setAppTheme, useAppTheme, THEME_STORAGE_KEY } from './use-app-theme'

export { AppShellLayout } from './frame'
export {
  MatterTabsProvider,
  useMatterTabs,
  useMatterTabsOptional,
  type MatterTabsValue,
} from './matter-tabs-state'
export {
  MATTER_TAB_LIMIT,
  matterTabFromPath,
  matterTabPath,
  matterTabStorageKey,
  type MatterTab,
  type MatterTabKind,
  type MatterTabState,
} from './matter-tabs'
export { MatterTabStrip } from './matter-tab-strip'
export { MatterTabsPane } from './matter-split'
export { PageScaffold, type PageScaffoldProps } from './page-scaffold'
export {
  classifyShellFailure,
  ShellError,
  ShellNotFound,
  ShellPermissionDenied,
  type ShellFailure,
} from './shell-states'

export { SignInRouteView } from './views/sign-in'
export { SignUpRedirectView } from './views/sign-up-redirect'
export { RequestAccessRouteView } from './views/request-access'
export { RequestAccessConfirmRouteView } from './views/request-access-confirm'
export { AcceptInviteRouteView } from './views/accept-invite'
export { ForgotPasswordRouteView } from './views/forgot-password'
export { ResetPasswordRouteView } from './views/reset-password'
export { HomeRouteView } from './views/home'
export { MattersRouteView } from './views/matters'
export { MatterRouteView } from './views/matter-detail'
export { VerifyRouteView } from './views/verify'
export { SettingsRouteView } from './views/settings'
export { validateSettingsSearch } from './settings-sections'
export { validateStaffFeedbackSearch, validateStaffUsageSearch } from './staff'
export { DocumentDetailLayoutView } from './views/document-detail'
export { caseResultLocation } from './case-navigation'
export { provisionResultLocation } from './legislation-navigation'

export {
  CaseLawDocumentView,
  caseLawDocumentQueryOptions,
} from './views/CaseLawDocumentView'
export type { CaseLawDocumentResponse } from './views/CaseLawDocumentView'
export {
  LegislationProvisionView,
  legislationProvisionQueryOptions,
} from './views/LegislationProvisionView'
export type { LegislationProvisionResponse } from './views/LegislationProvisionView'
export {
  LegislationActView,
  legislationActQueryOptions,
} from './views/LegislationActView'
export type { LegislationActResponse } from './views/LegislationActView'
export {
  createCanonicalCasePath,
  resolveCaseDocumentIdFromSlug,
} from '@obiter/contracts/case-paths'
export {
  LegalSearchView,
  LEGAL_SEARCH_DEBOUNCE_MS,
  courtOptionGroups,
  countActiveLegalSearchFilters,
  createLegalSearchFetchRequest,
  getCourtLabel,
  getLegalSearchEmptyFeedback,
  getLegalSearchStateAfterInputChange,
  getLegalSearchStateLabel,
  shouldRunLegalSearch,
  shouldRunLegalSearchRequest,
} from './views/LegalSearchView'
export {
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
} from './legal-search-selection'
export {
  LEGAL_SEARCH_RECENT_SEARCHES_LIMIT,
  getRecentLegalSearches,
  writeRecentLegalSearch,
} from './legal-search-recents'

export { AccessSetupRouteView } from './views/access-setup'
