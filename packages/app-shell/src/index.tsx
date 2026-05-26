import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { AppPlatform, MeResponse, ShellSnapshot } from '@ormont/contracts'
import { Card, EmptyState } from '@ormont/ui'
import wordmarkUrl from './assets/ormont-wordmark.svg'
import { OrmontSidebar } from './sidebar/OrmontSidebar'
export {
  CaseLawDocumentView,
  caseLawDocumentQueryOptions,
} from './views/CaseLawDocumentView'
export {
  LegalSearchView,
  courtOptionGroups,
  countActiveLegalSearchFilters,
  createLegalSearchFetchRequest,
  getCourtLabel,
  getLegalSearchStateAfterInputChange,
  getLegalSearchStateLabel,
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
} from './views/LegalSearchView'

const demoAuthStorageKey = 'ormont.phase0.authenticated'

interface ChangelogEntry {
  date: string | null
  title: string
  url: string
}

interface ChangelogResponse {
  entries: ChangelogEntry[]
  source: string
}

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

function canSeeDevelopmentStatus(me: MeResponse) {
  return me.organisation.id === 'org-ormont-demo' && me.user.role === 'owner'
}

function canSeeStaffNavigation(me: MeResponse) {
  return canSeeDevelopmentStatus(me)
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
  const navigate = useNavigate()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [authenticated, setAuthenticated] = useState(() =>
    currentPath === '/' || currentPath === '/sign-in'
      ? isDemoAuthenticated()
      : true,
  )

  if ((currentPath === '/' || currentPath === '/sign-in') && !authenticated) {
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
  const navigate = useNavigate()
  const [homeSearch, setHomeSearch] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const { data: me } = useSuspenseQuery(currentUserQueryOptions())
  const { data: changelog } = useSuspenseQuery(changelogQueryOptions())
  const activeMilestone = data.milestones.find((milestone) => milestone.status === 'active')
  const matterCount = data.matters.length
  const attentionItems = [
    {
      label: 'Review queue',
      status: 'Planned',
      detail: 'Document review, redaction checks, and verification tasks will surface here.',
    },
    {
      label: 'Deadlines',
      status: 'Planned',
      detail: 'Upcoming filing, hearing, and client response dates are not connected yet.',
    },
    {
      label: 'Matter activity',
      status: matterCount > 0 ? `${matterCount} active` : 'No live data',
      detail: matterCount > 0 ? 'Open matter workspaces are available.' : 'Matter records are not populated in this workspace yet.',
    },
  ]
  const sourceItems = [
    { label: 'Legal source search', status: 'Live', detail: 'Search public sources and open stored judgments.' },
    { label: 'Case pages', status: 'Live', detail: 'Fetched judgments have stable internal pages.' },
    { label: 'Statutes and timelines', status: 'Planned', detail: 'Legislation and relationship timelines belong in this search surface next.' },
  ]

  function handleHomeSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = homeSearch.trim()
    if (!query) {
      void navigate({ to: '/search' })
      return
    }

    window.sessionStorage.setItem('ormont.search.initialQuery', query)
    void navigate({ to: '/search' })
  }

  return (
    <div className="shell-stack workspace-page">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Home</p>
          <h1 className="shell-header__title">Home</h1>
        </div>
        <button
          aria-label="Open product updates"
          className="workspace-changelog-button"
          type="button"
          onClick={() => setChangelogOpen(true)}
        >
          <ClockIcon aria-hidden="true" />
        </button>
      </section>

      <form className="workspace-source-search" onSubmit={handleHomeSearch}>
        <label>
          <span>Search cases, statutes, issues</span>
          <input
            value={homeSearch}
            onChange={(event) => setHomeSearch(event.target.value)}
            placeholder="Potanina, limitation, Human Rights Act..."
            type="search"
          />
        </label>
        <button type="submit">Search</button>
      </form>

      <section className="workspace-dashboard" aria-label="Workspace dashboard">
        <article className="workspace-panel workspace-panel--attention">
          <div className="workspace-panel__header">
            <div>
          <p className="workspace-panel__eyebrow">Current status</p>
          <h2>Workspace signals</h2>
            </div>
            <span>{matterCount} matters</span>
          </div>
          <div className="workspace-list">
            {attentionItems.map((item) => (
              <div className="workspace-list__row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span>{item.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="workspace-panel workspace-panel--sources">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-panel__eyebrow">Legal sources</p>
              <h2>Search is live</h2>
            </div>
            <Link className="workspace-panel__link" to="/search">Open</Link>
          </div>
          <div className="workspace-list">
            {sourceItems.map((item) => (
              <div className="workspace-list__row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span>{item.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      {changelogOpen ? (
        <div className="workspace-updates-popover" role="dialog" aria-modal="false" aria-labelledby="workspace-changelog-title">
          <button
            aria-label="Close product updates"
            className="workspace-updates-popover__backdrop"
            type="button"
            onClick={() => setChangelogOpen(false)}
          />
          <section className="workspace-updates-popover__panel">
            <header className="workspace-updates-popover__header">
              <div>
                <p className="workspace-panel__eyebrow">Product updates</p>
                <h2 id="workspace-changelog-title">What changed recently</h2>
              </div>
              <button type="button" aria-label="Close product updates" onClick={() => setChangelogOpen(false)}>
                <XMarkIcon aria-hidden="true" />
              </button>
            </header>
            {changelog.entries.length > 0 ? (
              <div className="workspace-list">
                {changelog.entries.slice(0, 8).map((entry) => (
                  <a className="workspace-list__row" href={entry.url} key={entry.url} rel="noreferrer" target="_blank">
                    <div>
                      <strong>{entry.title}</strong>
                      <p>{entry.date ?? 'Date unavailable'}</p>
                    </div>
                    <span>GitHub</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="workspace-panel__empty">GitHub updates are unavailable right now.</p>
            )}
            {activeMilestone && canSeeDevelopmentStatus(me) ? (
              <section className="workspace-dev-status">
                <p className="workspace-panel__eyebrow">Development status</p>
                <h3>{activeMilestone.label}</h3>
                <p>{activeMilestone.detail}</p>
              </section>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  )
}

export function changelogQueryOptions() {
  return queryOptions({
    queryKey: ['github-changelog'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/changelog'))
      if (!response.ok) {
        return { entries: [], source: 'github_unavailable' } satisfies ChangelogResponse
      }

      return (await response.json()) as ChangelogResponse
    },
    staleTime: 1000 * 60 * 10,
  })
}

function apiUrl(path: string) {
  if (typeof window !== 'undefined') {
    return path
  }

  return new URL(
    path,
    process.env.ORMONT_API_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
  ).toString()
}

export function MattersRouteView({ platform }: { platform: AppPlatform }) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))

  return (
    <div className="shell-stack matters-page">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Matters</p>
          <h1 className="shell-header__title">Matters</h1>
        </div>
      </section>

      {data.matters.length > 0 ? (
        <section className="matter-list" aria-label="Matters">
          {data.matters.map((matter) => (
            <Link className="matter-row" key={matter.id} to="/matters/$matterId" params={{ matterId: matter.id }}>
              <span>
                <strong>{matter.name}</strong>
                <small>{matter.clientReference}</small>
              </span>
              <span>{matter.status}</span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="matters-empty">
          <p className="matters-empty__kicker">No matters yet</p>
          <h2>Start from a real matter workspace</h2>
          <p>
            Matter storage, uploads, redaction, drafting, and verification are planned surfaces.
            This page is ready for the first real matter workflow rather than placeholder records.
          </p>
          <div className="matters-empty__actions">
            <Link className="workspace-hero__action" to="/search">Search sources</Link>
            <span>Create matter planned</span>
          </div>
        </section>
      )}
    </div>
  )
}

export function MatterRouteView({
  matterId,
  platform,
}: {
  matterId: string
  platform: AppPlatform
}) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const matter = findMatterRecord(data, matterId)

  if (!matter) {
    return (
      <Card>
        <EmptyState
          title="Matter not found"
          body="This matter does not exist in the current organisation workspace."
          action={<Link className="shell-inline-link" to="/matters">Return to matters</Link>}
        />
      </Card>
    )
  }

  return (
    <div className="shell-stack">
      <Card eyebrow={matter.clientReference} title={matter.name}>
        <p className="shell-copy">{matter.summary}</p>
      </Card>
    </div>
  )
}

export {
  canSeeDevelopmentStatus as canSeeDevelopmentStatusForTest,
  canSeeStaffNavigation as canSeeStaffNavigationForTest,
  createPhaseZeroShellSnapshot,
  findMatterRecord,
}
