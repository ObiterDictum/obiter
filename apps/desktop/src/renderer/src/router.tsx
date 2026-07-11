import {
  AppShellLayout,
  DocumentDetailLayoutView,
  ForgotPasswordRouteView,
  HomeRouteView,
  MatterRouteView,
  MattersRouteView,
  ResetPasswordRouteView,
  SignInRouteView,
  caseLawDocumentQueryOptions,
  changelogQueryOptions,
  currentUserQueryOptions,
  documentQueryOptions,
  ensureOrganisation,
  guardAuth,
  matterDocumentsQueryOptions,
  matterQueryOptions,
  mattersListQueryOptions,
} from '@obiter/app-shell'
import { RedactionReviewView, RedactionRunsRegion, RedactionRunsView } from '@obiter/redact-ui'
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
import { DesktopCasePage } from '../../pages/case'
import { DesktopSearchPage } from '../../pages/search'

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
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
    await guardAuth(context.queryClient, () =>
      Promise.all([
        context.queryClient.ensureQueryData(currentUserQueryOptions()),
        context.queryClient.ensureQueryData(changelogQueryOptions()),
      ]),
    )
    await context.queryClient.prefetchQuery(mattersListQueryOptions())
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
    await context.queryClient.prefetchQuery(matterDocumentsQueryOptions(params.matterId))
  },
  component: DesktopMatterDetailRoute,
})

const documentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId/documents/$documentId',
  loader: async ({ context, params }) => {
    await ensureOrganisation(context.queryClient)
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(documentQueryOptions(params.documentId)),
    )
  },
  component: DesktopDocumentDetailRoute,
})

const redactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'redact',
  loader: ({ context }) => ensureOrganisation(context.queryClient),
  component: DesktopRedactionRunsRoute,
})

const redactReviewRoute = createRoute({
  getParentRoute: () => redactRoute,
  path: '$runId',
  component: DesktopRedactionReviewRoute,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'search',
  component: DesktopSearchPage,
})

const caseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cases/$caseId',
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(caseLawDocumentQueryOptions(params.caseId)),
  component: DesktopCaseRoute,
})

function DesktopMatterDetailRoute() {
  const { matterId } = matterDetailRoute.useParams()

  return <MatterRouteView matterId={matterId} platform="desktop" />
}

function DesktopDocumentDetailRoute() {
  const { matterId, documentId } = documentDetailRoute.useParams()
  const navigate = useNavigate()

  return <DocumentDetailLayoutView matterId={matterId} documentId={documentId} redactionRunsRegion={
    <RedactionRunsRegion
      documentId={documentId}
      onOpenRun={(runId) => navigate({ to: '/redact/$runId', params: { runId } })}
    />
  } />
}

function DesktopRedactionRunsRoute() {
  const navigate = useNavigate()
  return <RedactionRunsView onOpenRun={(runId) => navigate({ to: '/redact/$runId', params: { runId } })} />
}

function DesktopRedactionReviewRoute() {
  const { runId } = redactReviewRoute.useParams()
  return <RedactionReviewView runId={runId} />
}

function DesktopCaseRoute() {
  const { caseId } = caseRoute.useParams()

  return <DesktopCasePage caseId={caseId} />
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
  redactRoute.addChildren([redactReviewRoute]),
  searchRoute,
  caseRoute,
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
