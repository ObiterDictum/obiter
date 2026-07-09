import { AppShellLayout, DocumentDetailLayoutView, HomeRouteView, MatterRouteView, MattersRouteView, SignInRouteView, caseLawDocumentQueryOptions, shellSnapshotQueryOptions } from '@obiter/app-shell'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
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

  return <DocumentDetailLayoutView matterId={matterId} documentId={documentId} />
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
