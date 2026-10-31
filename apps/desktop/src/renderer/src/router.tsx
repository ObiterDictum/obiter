import {
  AppShellLayout,
  ForgotPasswordRouteView,
  HomeRouteView,
  ResetPasswordRouteView,
  SignInRouteView,
  SignUpRouteView,
  AcceptInviteRouteView,
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
import { Suspense, lazy, useEffect } from 'react'

let warmedDocumentDetail:
  | typeof import('@obiter/app-shell/views/document-detail').DocumentDetailLayoutView
  | undefined
let warmedRedactionRunsRegion:
  typeof import('@obiter/redact-ui/runs-region').RedactionRunsRegion | undefined

async function loadDocumentDetail() {
  const module = await import('@obiter/app-shell/views/document-detail')
  warmedDocumentDetail = module.DocumentDetailLayoutView
  return module
}

async function loadRedactionRunsRegion() {
  const module = await import('@obiter/redact-ui/runs-region')
  warmedRedactionRunsRegion = module.RedactionRunsRegion
  return module
}

let routeWarmupScheduled = false

function warmRouteChunks() {
  if (routeWarmupScheduled) return
  routeWarmupScheduled = true
  const imports = [
    loadDocumentDetail,
    loadRedactionRunsRegion,
    () => import('@obiter/app-shell/views/matter-detail'),
    () => import('@obiter/app-shell/views/matters'),
    () => import('../../pages/search'),
    () => import('../../pages/verify'),
    () => import('@obiter/app-shell/views/case-law-document'),
    () => import('@obiter/app-shell/views/legislation-provision'),
    () => import('@obiter/redact-ui/runs'),
    () => import('@obiter/redact-ui/review'),
    () => import('@obiter/app-shell/views/settings'),
  ]
  const scheduleNext = () => {
    const next = imports.shift()
    if (!next) return
    window.requestIdleCallback(
      () => {
        void next().then(scheduleNext, (error: unknown) => {
          console.error('Unable to warm desktop route', error)
          scheduleNext()
        })
      },
      { timeout: 1000 },
    )
  }
  scheduleNext()
}

const CaseLawDocumentView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/case-law-document'))
    .CaseLawDocumentView,
}))
const LegislationProvisionView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/legislation-provision'))
    .LegislationProvisionView,
}))
const DocumentDetailLayoutView = lazy(async () => ({
  default: (await loadDocumentDetail()).DocumentDetailLayoutView,
}))
const MatterRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/matter-detail'))
    .MatterRouteView,
}))
const MattersRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/matters')).MattersRouteView,
}))
const SettingsRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/settings')).SettingsRouteView,
}))
const RedactionRunsRegion = lazy(async () => ({
  default: (await loadRedactionRunsRegion()).RedactionRunsRegion,
}))
const RedactionRunsView = lazy(async () => ({
  default: (await import('@obiter/redact-ui/runs')).RedactionRunsView,
}))
const RedactionReviewView = lazy(async () => ({
  default: (await import('@obiter/redact-ui/review')).RedactionReviewView,
}))
const DesktopSearchPage = lazy(async () => ({
  default: (await import('../../pages/search')).DesktopSearchPage,
}))
const DesktopVerifyPage = lazy(async () => ({
  default: (await import('../../pages/verify')).DesktopVerifyRoute,
}))

function RouteLoading() {
  return (
    <p
      className="px-12 py-14 text-meta text-muted max-compact:px-8"
      role="status"
    >
      Loading…
    </p>
  )
}

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
  useEffect(warmRouteChunks, [])
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
  return (
    <Suspense fallback={<RouteLoading />}>
      <MattersRouteView platform="desktop" />
    </Suspense>
  )
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
  component: DesktopSearchRoute,
})

const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'verify',
  component: DesktopVerifyRoute,
})

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
  return (
    <Suspense fallback={<RouteLoading />}>
      <SettingsRouteView />
    </Suspense>
  )
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
  return (
    <Suspense fallback={<RouteLoading />}>
      <CaseLawDocumentView caseId={caseId} />
    </Suspense>
  )
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
  return (
    <Suspense fallback={<RouteLoading />}>
      <LegislationProvisionView provisionPath={provisionPath} />
    </Suspense>
  )
}

function DesktopMatterDetailRoute() {
  const { matterId } = matterDetailRoute.useParams()

  return (
    <Suspense fallback={<RouteLoading />}>
      <MatterRouteView matterId={matterId} platform="desktop" />
    </Suspense>
  )
}

function DesktopDocumentDetailRoute() {
  const { matterId, documentId } = documentDetailRoute.useParams()
  const navigate = useNavigate()
  const DocumentView = warmedDocumentDetail ?? DocumentDetailLayoutView
  const RunsRegion = warmedRedactionRunsRegion ?? RedactionRunsRegion

  return (
    <Suspense fallback={<RouteLoading />}>
      <DocumentView
        matterId={matterId}
        documentId={documentId}
        redactionRunsRegion={
          <RunsRegion
            documentId={documentId}
            onOpenRun={(runId) =>
              navigate({ to: '/redact/$runId', params: { runId } })
            }
          />
        }
      />
    </Suspense>
  )
}

function DesktopRedactionRunsRoute() {
  const navigate = useNavigate()
  return (
    <Suspense fallback={<RouteLoading />}>
      <RedactionRunsView
        onOpenRun={(runId) =>
          navigate({ to: '/redact/$runId', params: { runId } })
        }
      />
    </Suspense>
  )
}

function DesktopRedactionReviewRoute() {
  const { runId } = redactReviewRoute.useParams()
  const navigate = useNavigate()
  return (
    <Suspense fallback={<RouteLoading />}>
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

function DesktopSearchRoute() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <DesktopSearchPage />
    </Suspense>
  )
}

function DesktopVerifyRoute() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <DesktopVerifyPage />
    </Suspense>
  )
}

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sign-in',
  component: DesktopSignInRoute,
})

function DesktopSignInRoute() {
  useEffect(warmRouteChunks, [])
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
