import {
  AppShellLayout,
  CaseLawDocumentView,
  DocumentDetailLayoutView,
  ForgotPasswordRouteView,
  HomeRouteView,
  MatterRouteView,
  MattersRouteView,
  ResetPasswordRouteView,
  SignInRouteView,
  caseLawDocumentQueryOptions,
  createCanonicalCasePath,
  documentQueryOptions,
  ensureOrganisation,
  guardAuth,
  matterDocumentsQueryOptions,
  matterQueryOptions,
  mattersListQueryOptions,
  prefetchHomeData,
  resolveCaseDocumentIdFromSlug,
} from '@obiter/app-shell'
import {
  RedactionReviewView,
  RedactionRunsRegion,
  RedactionRunsView,
} from '@obiter/redact-ui'
import { EmptyState } from '@obiter/ui'
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
  '/cases/$caseId',
  '/case/$caseSlug',
  '/sign-in',
  '/forgot-password',
  '/reset-password',
] as const

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: DesktopNotFound,
})

function RootLayout() {
  return (
    <AppShellLayout platform="desktop">
      <Outlet />
    </AppShellLayout>
  )
}

function DesktopNotFound() {
  return (
    <EmptyState
      title="Page not found"
      body="That route is not registered in the desktop shell. Check the URL or return Home from the sidebar."
    />
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
    await ensureOrganisation(context.queryClient)
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
    await ensureOrganisation(context.queryClient)
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
    await ensureOrganisation(context.queryClient)
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(
        documentQueryOptions(params.documentId),
      ),
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
  loader: ({ context }) => ensureOrganisation(context.queryClient),
  component: DesktopRedactionRunsRoute,
})

const redactReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'redact/$runId',
  loader: ({ context }) => ensureOrganisation(context.queryClient),
  component: DesktopRedactionReviewRoute,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'search',
  component: DesktopSearchPage,
})

const casesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cases/$caseId',
  loader: async ({ context, params }) => {
    const document = await context.queryClient.ensureQueryData(
      caseLawDocumentQueryOptions(params.caseId),
    )
    const canonicalPath = createCanonicalCasePath(document)
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
    return context.queryClient.ensureQueryData(
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
  return <RedactionReviewView runId={runId} />
}

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sign-in',
  component: DesktopSignInRoute,
})

function DesktopSignInRoute() {
  return <SignInRouteView platform="desktop" />
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
  casesRoute,
  caseSlugRoute,
  signInRoute,
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
