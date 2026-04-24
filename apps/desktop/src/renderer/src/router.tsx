import { AppShellLayout, HomeRouteView, MatterRouteView, MattersRouteView, SignInRouteView, shellSnapshotQueryOptions } from '@ormont/app-shell'
import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

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

function DesktopMatterDetailRoute() {
  const { matterId } = matterDetailRoute.useParams()

  return <MatterRouteView matterId={matterId} platform="desktop" />
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
