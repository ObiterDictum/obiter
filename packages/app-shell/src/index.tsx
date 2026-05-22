import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { AppPlatform, MeResponse, ShellSnapshot } from '@ormont/contracts'
import { Card, EmptyState } from '@ormont/ui'
import ladyJusticeUrl from './assets/login-lady-justice.png'
import wordmarkUrl from './assets/ormont-wordmark.svg'
import { ApiMatterRouteView } from './matter-documents'
import { ApiMattersRouteView } from './matter-list'
import { OrmontSidebar } from './sidebar/OrmontSidebar'

const demoAuthStorageKey = 'ormont.phase0.authenticated'

function isDemoAuthenticated() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(demoAuthStorageKey) === 'true'
}

function setDemoAuthenticated(value: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  if (value) {
    window.localStorage.setItem(demoAuthStorageKey, 'true')
    return
  }

  window.localStorage.removeItem(demoAuthStorageKey)
}

export function createDemoMeResponse(): MeResponse {
  return {
    user: {
      id: 'user-amorgan',
      email: 'amorgan@ormont.local',
      name: 'A. Morgan',
      role: 'owner',
    },
    organisation: {
      id: 'org-ormont-demo',
      name: 'Ormont Legal',
      plan: 'private_beta',
    },
  }
}

function createPhaseZeroShellSnapshot(platform: AppPlatform): ShellSnapshot {
  return {
    platform,
    organisation: {
      ...createDemoMeResponse().organisation,
      seatCount: 1,
    },
    currentUser: createDemoMeResponse().user,
    matters: [],
    featuredMatterId: '',
    metrics: [],
    milestones: [
      {
        id: 'milestone-auth',
        label: '0.2 Auth foundation',
        detail: 'Sign-in, organisation context, and protected shell routes.',
        status: 'active',
      },
    ],
    alerts: [],
  }
}

function findMatterRecord(snapshot: ShellSnapshot, matterId: string) {
  return snapshot.matters.find((matter) => matter.id === matterId)
}

export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: ['phase-0-current-user'],
    queryFn: async () => createDemoMeResponse(),
    staleTime: Infinity,
  })
}

export function shellSnapshotQueryOptions(platform: AppPlatform) {
  return queryOptions({
    queryKey: ['phase-0-shell', platform],
    queryFn: async () => createPhaseZeroShellSnapshot(platform),
    staleTime: Infinity,
  })
}

function ShellSidebar({
  onSignOut,
  platform,
}: {
  onSignOut: () => void
  platform: AppPlatform
}) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  return <OrmontSidebar currentPath={currentPath} onSignOut={onSignOut} snapshot={data} />
}

function AuthScreen({
  onAuthenticated,
  platform,
}: {
  onAuthenticated: () => void
  platform: AppPlatform
}) {
  return (
    <div className="auth-page">
      <img
        alt=""
        aria-hidden="true"
        className="auth-hero-art"
        src={ladyJusticeUrl}
      />
      <SignInRouteView onAuthenticated={onAuthenticated} platform={platform} />
    </div>
  )
}

export function AppShellLayout({
  children,
  platform,
}: {
  children: ReactNode
  platform: AppPlatform
}) {
  const [authenticated, setAuthenticated] = useState(isDemoAuthenticated)
  const navigate = useNavigate()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  if (!authenticated || currentPath === '/' || currentPath === '/sign-in') {
    return <AuthScreen onAuthenticated={() => setAuthenticated(true)} platform={platform} />
  }

  function handleSignOut() {
    setDemoAuthenticated(false)
    setAuthenticated(false)
    void navigate({ to: '/' })
  }

  return (
    <div className="shell-layout">
      <ShellSidebar onSignOut={handleSignOut} platform={platform} />
      <main className="shell-main">{children}</main>
    </div>
  )
}

export function SignInRouteView({
  onAuthenticated,
  platform,
}: {
  onAuthenticated?: () => void
  platform: AppPlatform
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'password' | 'magic-link'>('password')
  const showDevelopmentBypass = import.meta.env.DEV

  function completeSignIn() {
    setDemoAuthenticated(true)
    onAuthenticated?.()
    void navigate({ to: '/workspace' })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    completeSignIn()
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <img className="auth-brand__wordmark" src={wordmarkUrl} alt="Ormont" />
        <h1 className="auth-brand__title">Sign in</h1>
      </section>

      <Card>
        <div className="auth-panel">
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>

            <label
              aria-hidden={mode !== 'password'}
              className={mode === 'password' ? 'auth-field' : 'auth-field auth-field--reserved'}
            >
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                disabled={mode !== 'password'}
                minLength={8}
                required={mode === 'password'}
                tabIndex={mode === 'password' ? 0 : -1}
              />
            </label>

            <button className="auth-button" type="submit">
              Continue
            </button>
          </form>

          <div className="auth-tabs" aria-label="Sign-in method">
            <button
              aria-pressed={mode === 'password'}
              className="auth-tab"
              type="button"
              onClick={() => setMode('password')}
            >
              Password
            </button>
            <button
              aria-pressed={mode === 'magic-link'}
              className="auth-tab"
              type="button"
              onClick={() => setMode('magic-link')}
            >
              Magic link
            </button>
          </div>

          {showDevelopmentBypass ? (
            <button className="auth-dev-bypass" type="button" onClick={completeSignIn}>
              Skip sign in for development
            </button>
          ) : null}
        </div>
      </Card>
    </main>
  )
}

export function HomeRouteView({ platform }: { platform: AppPlatform }) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const activeMilestone = data.milestones.find((milestone) => milestone.status === 'active')

  return (
    <div className="shell-stack">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Workspace</p>
          <h1 className="shell-header__title">Workspace reset</h1>
        </div>
      </section>

      <Card title="Ready for a new workspace direction">
        <p className="shell-copy">
          The previous workspace mock has been removed. The next pass should start from the product
          spec and the active milestone instead of inherited placeholder content.
        </p>
      </Card>

      {activeMilestone ? (
        <Card eyebrow="Active milestone" title={activeMilestone.label}>
          <p className="shell-copy">{activeMilestone.detail}</p>
        </Card>
      ) : null}
    </div>
  )
}

export function MattersRouteView({ platform }: { platform: AppPlatform }) {
  useSuspenseQuery(shellSnapshotQueryOptions(platform))

  return <ApiMattersRouteView />
}

export function MatterRouteView({
  matterId,
  platform,
}: {
  matterId: string
  platform: AppPlatform
}) {
  useSuspenseQuery(shellSnapshotQueryOptions(platform))

  return <ApiMatterRouteView matterId={matterId} />
}

export { createPhaseZeroShellSnapshot, findMatterRecord }
export {
  createDocumentMetadataMutationOptions,
  createMatterQueryOptions,
  createDocumentMetadata,
  deleteDocument,
  deleteDocumentMutationOptions,
  invalidateMatterDocuments,
  listMatterDocumentsQueryOptions,
} from './api'
export {
  describeMatterDocument,
  getMatterDocumentLabel,
  getMatterDocumentListState,
} from './matter-documents'
