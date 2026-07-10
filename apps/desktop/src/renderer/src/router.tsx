import { AppShellLayout, DocumentDetailLayoutView, HomeRouteView, MatterRouteView, MattersRouteView, SignInRouteView, caseLawDocumentQueryOptions, shellSnapshotQueryOptions } from '@obiter/app-shell'
import { RedactionReviewView, RedactionRunsRegion, RedactionRunsView } from '@obiter/redact-ui'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
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
  component: DesktopSignInRoute,
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspace',
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('desktop')),
  component: DesktopWorkspaceRoute,
})

function DesktopWorkspaceRoute() {
  return <HomeRouteView platform="desktop" />
}

const mattersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters',
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('desktop')),
  component: DesktopMattersRoute,
})

function DesktopMattersRoute() {
  return <MattersRouteView platform="desktop" />
}

const matterDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId',
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('desktop')),
  component: DesktopMatterDetailRoute,
})

const documentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId/documents/$documentId',
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('desktop')),
  component: DesktopDocumentDetailRoute,
})

const redactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'redact',
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
