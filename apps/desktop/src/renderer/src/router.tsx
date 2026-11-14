import {
  AccessSetupRouteView,
  AppShellLayout,
  ForgotPasswordRouteView,
  HomeRouteView,
  ResetPasswordRouteView,
  SignInRouteView,
  SignUpRedirectView,
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
  prefetchVerifyData,
  resolveCaseDocumentIdFromSlug,
  useMatterTabsOptional,
  validateSettingsSearch,
  validateStaffFeedbackSearch,
  validateStaffUsageSearch,
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
import { Suspense, lazy, use, useEffect } from 'react'
import { preloadable } from './route-preload'

const documentDetailModule = preloadable(
  () => import('@obiter/app-shell/views/document-detail'),
)
const redactionRunsRegionModule = preloadable(
  () => import('@obiter/redact-ui/runs-region'),
)

let routeWarmupScheduled = false

function warmRouteChunks() {
  if (routeWarmupScheduled) return
  routeWarmupScheduled = true
  const imports = [
    documentDetailModule,
    redactionRunsRegionModule,
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
const MatterVerifyView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/verify')).VerifyRouteView,
}))
const StaffOverviewRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/staff-overview'))
    .StaffOverviewRouteView,
}))
const StaffUsageRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/staff-usage'))
    .StaffUsageRouteView,
}))
const StaffErrorsRouteView = lazy(async () => ({default:(await import('@obiter/app-shell/views/staff-errors')).StaffErrorsRouteView}))
const StaffFeedbackRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/staff-feedback'))
    .StaffFeedbackRouteView,
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
  '/matters/$matterId/verify',
  '/matters/$matterId/redact/$runId',
  '/redact',
  '/redact/$runId',
  '/search',
  '/staff',
  '/staff/access',
  '/staff/usage',
  '/staff/feedback',
  '/staff/errors',
  '/request-access/setup',
  '/settings',
  '/verify',
  '/cases/$caseId',
  '/case/$caseSlug',
  '/ln/$',
  '/sign-in',
  '/sign-up',
  '/request-access',
  '/request-access/confirm',
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

const matterVerifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId/verify',
  loader: async ({ context }) => {
    await prefetchVerifyData(context.queryClient)
  },
  component: DesktopMatterVerifyRoute,
})

function DesktopMatterVerifyRoute() {
  const { matterId } = matterVerifyRoute.useParams()
  return (
    <Suspense fallback={<RouteLoading />}>
      <MatterVerifyView matterId={matterId} />
    </Suspense>
  )
}

const matterRedactReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'matters/$matterId/redact/$runId',
  component: DesktopMatterRedactionReviewRoute,
})

function DesktopMatterRedactionReviewRoute() {
  const { matterId, runId } = matterRedactReviewRoute.useParams()
  const navigate = useNavigate()
  return (
    <Suspense fallback={<RouteLoading />}>
      <RedactionReviewView
        runId={runId}
        onOpenRun={(replacementRunId) =>
          navigate({
            to: '/matters/$matterId/redact/$runId',
            params: { matterId, runId: replacementRunId },
          })
        }
        onBack={() =>
          navigate({ to: '/matters/$matterId', params: { matterId } })
        }
        onOpenDocument={({ documentId }) => {
          void navigate({
            to: '/matters/$matterId/documents/$documentId',
            params: { matterId, documentId },
          })
        }}
      />
    </Suspense>
  )
}

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'search',
  validateSearch: (search: Record<string, unknown>) => {
    const query = search.q
    if (typeof query !== 'string' || !query.trim()) return {}
    return { q: query }
  },
  component: DesktopSearchRoute,
})

const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'verify',
  component: DesktopVerifyRoute,
})

const StaffRouteView = lazy(async () => ({
  default: (await import('@obiter/app-shell/views/staff')).StaffRouteView,
}))
const staffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'staff',
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: () => (
    <Suspense fallback={<RouteLoading />}>
      <StaffOverviewRouteView />
    </Suspense>
  ),
})
const staffAccessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'staff/access',
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: () => (
    <Suspense fallback={<RouteLoading />}>
      <StaffRouteView />
    </Suspense>
  ),
})
const staffUsageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'staff/usage',
  validateSearch: validateStaffUsageSearch,
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: () => (
    <Suspense fallback={<RouteLoading />}>
      <StaffUsageRouteView />
    </Suspense>
  ),
})
const staffErrorsRoute = createRoute({getParentRoute:() => rootRoute,path:'staff/errors',component:() => <Suspense fallback={<RouteLoading />}><StaffErrorsRouteView /></Suspense>})
const staffFeedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'staff/feedback',
  validateSearch: validateStaffFeedbackSearch,
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: () => (
    <Suspense fallback={<RouteLoading />}>
      <StaffFeedbackRouteView />
    </Suspense>
  ),
})
const accessSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'request-access/setup',
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: AccessSetupRouteView,
})

const AgentWindowView = lazy(() =>
  import('@obiter/app-shell/views/agent-window').then((m) => ({
    default: m.AgentWindowView,
  })),
)
const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'agent',
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: () => (
    <Suspense fallback={<RouteLoading />}>
      <AgentWindowView />
    </Suspense>
  ),
})
const agentSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'agent/$sessionId',
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: () => (
    <Suspense fallback={<RouteLoading />}>
      <AgentWindowView />
    </Suspense>
  ),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  validateSearch: validateSettingsSearch,
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

  return (
    <Suspense fallback={<RouteLoading />}>
      <DesktopDocumentDetail matterId={matterId} documentId={documentId} />
    </Suspense>
  )
}

function DesktopDocumentDetail({
  matterId,
  documentId,
}: {
  matterId: string
  documentId: string
}) {
  const navigate = useNavigate()
  const tabs = useMatterTabsOptional()
  const { DocumentDetailLayoutView } = use(documentDetailModule())
  const { RedactionRunsRegion } = use(redactionRunsRegionModule())

  return (
    <DocumentDetailLayoutView
      matterId={matterId}
      documentId={documentId}
      onDocumentEdited={tabs?.promoteActive}
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
  return <SignUpRedirectView platform="desktop" />
}

const requestAccessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'request-access',
  beforeLoad: () => {
    throw redirect({ to: '/sign-in', replace: true })
  },
})

const requestAccessConfirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'request-access/confirm',
  beforeLoad: () => {
    throw redirect({ to: '/sign-in', replace: true })
  },
})

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
  return <AcceptInviteRouteView platform="desktop" />
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
  matterVerifyRoute,
  matterRedactReviewRoute,
  redactRoute,
  redactReviewRoute,
  searchRoute,
  verifyRoute,
  staffRoute,
  staffAccessRoute,
  staffUsageRoute,
  staffFeedbackRoute,
  staffErrorsRoute,
  accessSetupRoute,
  settingsRoute,
  agentRoute,
  agentSessionRoute,
  casesRoute,
  caseSlugRoute,
  legislationRoute,
  signInRoute,
  signUpRoute,
  requestAccessRoute,
  requestAccessConfirmRoute,
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
