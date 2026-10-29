import {
  AppShellLayout,
  CaseLawDocumentView,
  LegislationProvisionView,
  DocumentDetailLayoutView,
  ForgotPasswordRouteView,
  HomeRouteView,
  MatterRouteView,
  MattersRouteView,
  ResetPasswordRouteView,
  SignInRouteView,
  SignUpRouteView,
  AcceptInviteRouteView,
  SettingsRouteView,
  ShellError,
  ShellNotFound,
  caseLawDocumentQueryOptions,
  legislationProvisionQueryOptions,
  createCanonicalCasePath,
  documentQueryOptions,
  guardAuth,
  matterDocumentsQueryOptions,
  matterQueryOptions,
  mattersListQueryOptions,
  currentUserQueryOptions,
  prefetchHomeData,
  prefetchInviteAcceptData,
  resolveCaseDocumentIdFromSlug,
} from '@obiter/app-shell'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { DesktopSearchPage } from '../../pages/search'
import { Suspense, lazy } from 'react'
import { VerifyRouteView } from '@obiter/app-shell'

/**
 * Redact is a whole module with its own review desk, PDF preview and output
 * screens. Loading it lazily keeps it out of the renderer's initial bundle:
 * the desktop app boots on the dashboard, and a redaction screen is one chunk
 * fetched on the first visit to /redact.
 */
import { RedactionRunsRegion, RedactionRunsView } from '@obiter/redact-ui'

// The review desk pulls the span panel, the decision bar, the output screens
// and the PDF preview. It is a chunk of its own, fetched on the first visit to
// /redact/:runId; the runs list and the document page's runs region stay in the
// entry because the document page renders them.
const RedactionReviewView = lazy(async () => ({
  default: (await import('@obiter/redact-ui/review')).RedactionReviewView,
}))

function RedactLoading() {
  return (
    <p
      className="px-12 py-14 text-meta text-muted max-compact:px-8"
      role="status"
    >
      Loading redaction…
    </p>
  )
}

/**
 * Shared-view paths the web app exposes that desktop must also register.
 * Kept here so router.parity.test.ts can catch route drift permanently.
 */
export const DESKTOP_SHARED_VIEW_PATHS = [
  '/',
  '/workspace',
  '/matters',
  '/matters/$matterId',
  '/matters/$matterId/documents/$documentId',
  '/redact',
  '/redact/$runId',
  '/search',
  '/settings',
  '/verify',
  '/cases/$caseId',
  '/case/$caseSlug',
  '/ln/$',
  '/sign-in',
  '/sign-up',
  '/invites/accept',
  '/forgot-password',
  '/reset-password',
] as const

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: ShellNotFound,
  errorComponent: ShellError,
})

function RootLayout() {
  return (
    <AppShellLayout platform="desktop">
      <Outlet />
    </AppShellLayout>
  )
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async ({ context }) => {
    await prefetchHomeData(context.queryClient)
  },
  component: DesktopHomeRoute,
})

function DesktopHomeRoute() {
  return <HomeRouteView platform="desktop" />
}

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspace',
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})

const mattersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters',
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(mattersListQueryOptions()),
    )
  },
  component: DesktopMattersRoute,
})

function DesktopMattersRoute() {
  return <MattersRouteView platform="desktop" />
}

const matterDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId',
  loader: async ({ context, params }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(matterQueryOptions(params.matterId)),
    )
    await context.queryClient.prefetchQuery(
      matterDocumentsQueryOptions(params.matterId),
    )
  },
  component: DesktopMatterDetailRoute,
})

const documentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId/documents/$documentId',
  loader: async ({ context, params }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(
        documentQueryOptions(params.documentId),
      ),
    )
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(matterQueryOptions(params.matterId)),
    )
  },
  component: DesktopDocumentDetailRoute,
})

// Sibling routes (not parent→child): match web's /redact/ + /redact/$runId so
// navigating to a run replaces the runs list instead of nesting under it
// without an Outlet (which made Review appear to do nothing).
const redactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'redact',
  component: DesktopRedactionRunsRoute,
})

const redactReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'redact/$runId',
  component: DesktopRedactionReviewRoute,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'search',
  component: DesktopSearchPage,
})

const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'verify',
  component: DesktopVerifyRoute,
})

export function DesktopVerifyRoute() {
  return <VerifyRouteView />
}

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: DesktopSettingsRoute,
})

function DesktopSettingsRoute() {
  return <SettingsRouteView />
}

const casesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cases/$caseId',
  loader: async ({ context, params }) => {
    const response = await context.queryClient.ensureQueryData(
      caseLawDocumentQueryOptions(params.caseId),
    )
    const canonicalPath = createCanonicalCasePath(response.document)
    const caseSlug = canonicalPath.replace(/^\/case\//, '')
    throw redirect({ to: '/case/$caseSlug', params: { caseSlug } })
  },
  component: DesktopCasesRedirectRoute,
})

function DesktopCasesRedirectRoute() {
  // Loader always redirects; component is a typed-route placeholder.
  return null
}

const caseSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'case/$caseSlug',
  loader: ({ context, params }) => {
    const caseId = resolveCaseDocumentIdFromSlug(params.caseSlug)
    return context.queryClient.prefetchQuery(
      caseLawDocumentQueryOptions(caseId),
    )
  },
  component: DesktopCaseSlugRoute,
})

function DesktopCaseSlugRoute() {
  const { caseSlug } = caseSlugRoute.useParams()
  const caseId = resolveCaseDocumentIdFromSlug(caseSlug)
  return <CaseLawDocumentView caseId={caseId} />
}

const legislationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'ln/$',
  loader: ({ context, params }) => {
    const provisionPath = params._splat
    if (!provisionPath) {
      throw new Error('Legislation provision path is missing.')
    }
    return context.queryClient.prefetchQuery(
      legislationProvisionQueryOptions(provisionPath),
    )
  },
  component: DesktopLegislationRoute,
})

function DesktopLegislationRoute() {
  const { _splat: provisionPath } = legislationRoute.useParams()
  if (!provisionPath) {
    throw new Error('Legislation provision path is missing.')
  }
  return <LegislationProvisionView provisionPath={provisionPath} />
}

function DesktopMatterDetailRoute() {
  const { matterId } = matterDetailRoute.useParams()

  return <MatterRouteView matterId={matterId} platform="desktop" />
}

function DesktopDocumentDetailRoute() {
  const { matterId, documentId } = documentDetailRoute.useParams()
  const navigate = useNavigate()

  return (
    <DocumentDetailLayoutView
      matterId={matterId}
      documentId={documentId}
      redactionRunsRegion={
        <RedactionRunsRegion
          documentId={documentId}
          onOpenRun={(runId) =>
            navigate({ to: '/redact/$runId', params: { runId } })
          }
        />
      }
    />
  )
}

function DesktopRedactionRunsRoute() {
  const navigate = useNavigate()
  return (
    <RedactionRunsView
      onOpenRun={(runId) =>
        navigate({ to: '/redact/$runId', params: { runId } })
      }
    />
  )
}

function DesktopRedactionReviewRoute() {
  const { runId } = redactReviewRoute.useParams()
  const navigate = useNavigate()
  return (
    <Suspense fallback={<RedactLoading />}>
      <RedactionReviewView
        runId={runId}
        onOpenRun={(replacementRunId) =>
          navigate({
            to: '/redact/$runId',
            params: { runId: replacementRunId },
          })
        }
        onBack={() => void navigate({ to: '/redact' })}
        onOpenDocument={({ matterId, documentId }) => {
          void navigate({
            to: '/matters/$matterId/documents/$documentId',
            params: { matterId, documentId },
          })
        }}
      />
    </Suspense>
  )
}

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sign-in',
  component: DesktopSignInRoute,
})

function DesktopSignInRoute() {
  return <SignInRouteView platform="desktop" />
}

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sign-up',
  component: DesktopSignUpRoute,
})

function DesktopSignUpRoute() {
  return <SignUpRouteView />
}

interface AcceptInviteSearch {
  token: string
}

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'invites/accept',
  validateSearch: (search: Record<string, unknown>): AcceptInviteSearch => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  loader: async ({ context, location }) => {
    const token =
      new URLSearchParams(location.searchStr.replace(/^\?/u, '')).get(
        'token',
      ) ?? ''
    await prefetchInviteAcceptData(context.queryClient, token)
  },
  component: DesktopAcceptInviteRoute,
})

function DesktopAcceptInviteRoute() {
  return <AcceptInviteRouteView />
}

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'forgot-password',
  component: DesktopForgotPasswordRoute,
})

function DesktopForgotPasswordRoute() {
  return <ForgotPasswordRouteView />
}

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reset-password',
  component: DesktopResetPasswordRoute,
})

function DesktopResetPasswordRoute() {
  return <ResetPasswordRouteView />
}

const routeTree = rootRoute.addChildren([
  indexRoute,
  workspaceRoute,
  mattersRoute,
  matterDetailRoute,
  documentDetailRoute,
  redactRoute,
  redactReviewRoute,
  searchRoute,
  verifyRoute,
  settingsRoute,
  casesRoute,
  caseSlugRoute,
  legislationRoute,
  signInRoute,
  signUpRoute,
  acceptInviteRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: {
      queryClient,
    },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
