import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Clock,
  Folders,
  MagnifyingGlass,
  Sparkle,
  X,
} from '@phosphor-icons/react'
import { Button, Card, Input, Skeleton } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useState, type FormEvent } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { changelogQueryOptions } from '../changelog'
import { useMattersList } from '../matters'
import { ApiError } from '../api'
import { useCreateOrganisation, useCurrentUser } from '../current-user'

/**
 * Home — the authenticated landing surface. For an org-less user this renders
 * the create-organisation state instead of matters/search content, because
 * matters and documents live inside an organisation. Once an org exists,
 * greeting + a single hero search entry + a "live today" set of surfaces
 * driven by real data (the signed-in user's actual matters). No invented
 * widgets: every value shown comes from a real endpoint. No fixture snapshot.
 */
export function HomeRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const { data: me } = useCurrentUser()

  if (!me.organisation) {
    return <CreateOrganisationState name={me.user.name} />
  }

  return (
    <OrganisationHome
      organisationName={me.organisation.name}
      userName={me.user.name}
    />
  )
}

/**
 * Minimal create-organisation surface for org-less users. One field, one
 * action, calm copy. This is deliberately not a settings area — when settings
 * exist later, org creation moves/extends there. On success the current-user
 * query is invalidated so /api/me refetches and the shell flips to the
 * matters Home without a full reload.
 */
function CreateOrganisationState({ name }: { name: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createOrganisation = useCreateOrganisation()
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = orgName.trim()
    if (!trimmed) {
      setError('Organisation name is required.')
      return
    }
    setError(null)
    try {
      await createOrganisation.mutateAsync({ name: trimmed })
      await navigate({ to: '/' })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict_detected') {
        // The user already has an organisation, so the cached /api/me is
        // stale. Refresh it and tell them — they do not need to create one.
        setError('You already have an organisation. Refreshing…')
        try {
          await queryClient.refetchQueries({ queryKey: ['current-user'] })
        } catch {
          // If the refetch fails, do not leave the user stuck on
          // "Refreshing…" — fall back to a retryable generic error.
          setError('Could not refresh your account. Reload the page.')
        }
      } else {
        setError('Could not create the organisation. Try again.')
      }
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Welcome to Obiter, {name.split(' ')[0]}
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          Matters and documents live inside an organisation. Create one to get
          started. You can rename it later.
        </p>
      </header>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={handleCreate}>
          <Input
            label="Organisation name"
            type="text"
            autoComplete="organization"
            required
            maxLength={120}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            error={error ?? undefined}
          />
          <Button
            type="submit"
            loading={createOrganisation.isPending}
            iconEnd={<ArrowRight size={16} weight="bold" />}
            className="w-full"
          >
            Create organisation
          </Button>
        </form>
      </Card>
    </div>
  )
}

function OrganisationHome({
  organisationName,
  userName,
}: {
  organisationName: string
  userName: string
}) {
  const navigate = useNavigate()
  const [homeSearch, setHomeSearch] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const matters = useMattersList()
  const { data: changelog } = useSuspenseQuery(changelogQueryOptions())

  // Only treat the list as empty on a confirmed-empty *successful* response —
  // a pending or failed fetch must not render the "create your first matter"
  // empty state.
  const matterCount = matters.data?.length ?? 0
  const mattersDetail = matters.isLoading
    ? 'loading'
    : matters.isError
      ? 'error'
      : matterCount > 0
        ? 'count'
        : 'empty'
  const firstName = userName.split(' ')[0]
  const recentMatters = matters.data?.slice(0, 4) ?? []

  function handleHomeSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = homeSearch.trim()
    if (query) {
      window.sessionStorage.setItem('obiter.search.initialQuery', query)
    }
    void navigate({ to: '/search' })
  }

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {organisationName}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Welcome back, {firstName}
          </h1>
        </div>
        <button
          aria-label="Open product updates"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          type="button"
          onClick={() => setChangelogOpen(true)}
        >
          <Clock aria-hidden="true" size={16} />
          Updates
        </button>
      </header>

      {/* Hero search entry — the single, prominent way into Search. */}
      <form className="group flex flex-col gap-2" onSubmit={handleHomeSearch}>
        <label className="text-sm font-medium text-muted" htmlFor="home-search">
          Search legal sources
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 transition-colors focus-within:border-brand">
          <MagnifyingGlass
            aria-hidden="true"
            size={18}
            className="text-subtle"
          />
          <input
            id="home-search"
            className="min-h-[28px] flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle"
            value={homeSearch}
            onChange={(event) => setHomeSearch(event.target.value)}
            placeholder="Case name, neutral citation, or keyword — e.g. Potanina"
            type="search"
            autoFocus
          />
          <button
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-pressed"
            type="submit"
          >
            Search
            <ArrowRight aria-hidden="true" size={15} weight="bold" />
          </button>
        </div>
      </form>

      {/* Live surfaces — what you can do today. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Live today
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SurfaceCard
            to="/search"
            icon={<MagnifyingGlass aria-hidden="true" size={18} />}
            title="Legal source search"
            detail="Search stored judgments and Find Case Law across courts."
          />
          <SurfaceCard
            to="/matters"
            icon={<Folders aria-hidden="true" size={18} />}
            title="Matters"
            detail={
              mattersDetail === 'loading'
                ? 'Loading your matters…'
                : mattersDetail === 'error'
                  ? 'Your matters could not be loaded. Open Matters to retry.'
                  : mattersDetail === 'count'
                    ? `${matterCount} ${matterCount === 1 ? 'matter' : 'matters'} in your organisation.`
                    : 'Create your first matter workspace.'
            }
          />
          <SurfaceCard
            to="/search"
            icon={<Sparkle aria-hidden="true" size={18} />}
            title="Case pages"
            detail="Fetched judgments have stable, citable internal pages."
          />
        </div>
      </section>

      {/* Recent matters — real data, not fixture rows. Only rendered when there
          is something honest to show: rows on success, a skeleton while pending,
          an error note on failure. A confirmed-empty list hides the section. */}
      {mattersDetail === 'loading' ? (
        <section
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Loading recent matters"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Recent matters
          </h2>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </section>
      ) : mattersDetail === 'error' ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Recent matters
          </h2>
          <p className="text-sm text-muted">
            Your matters could not be loaded.{' '}
            <Link
              to="/matters"
              className="font-semibold text-brand hover:text-brand-pressed"
            >
              Open Matters
            </Link>{' '}
            to retry.
          </p>
        </section>
      ) : recentMatters.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Recent matters
            </h2>
            <Link
              to="/matters"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-pressed"
            >
              All matters
              <ArrowRight aria-hidden="true" size={14} weight="bold" />
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {recentMatters.map((matter) => (
              <li key={matter.id}>
                <Link
                  to="/matters/$matterId"
                  params={{ matterId: matter.id }}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3.5 transition-colors hover:border-line-strong"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-ink">
                      {matter.name}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {matter.clientReference || 'No reference'}
                      {matter.primaryJurisdiction
                        ? ` · ${matter.primaryJurisdiction}`
                        : ''}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    size={14}
                    weight="bold"
                    className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* What's coming — quiet, honest about planned surfaces. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
          In progress
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          Redaction, verification, drafting, research, and deadlines are planned
          surfaces on the roadmap. The shell is ready for each as it lands.
        </p>
      </section>

      {changelogOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-end overflow-y-auto bg-overlay p-6"
          role="dialog"
          aria-modal="false"
          aria-labelledby="workspace-changelog-title"
        >
          <button
            aria-label="Close product updates"
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setChangelogOpen(false)}
          />
          <section className="relative mt-16 w-full max-w-[560px] rounded-lg border border-line-strong bg-raised p-5 shadow-lg">
            <header className="mb-4 flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  Product updates
                </p>
                <h2
                  className="text-lg font-semibold text-ink"
                  id="workspace-changelog-title"
                >
                  What changed recently
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close product updates"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-muted transition-colors hover:bg-canvas hover:text-ink"
                onClick={() => setChangelogOpen(false)}
              >
                <X aria-hidden="true" size={17} />
              </button>
            </header>
            {changelog.entries.length > 0 ? (
              <div className="flex flex-col divide-y divide-line">
                {changelog.entries.slice(0, 8).map((entry) => (
                  <a
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                    href={entry.url}
                    key={entry.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <div className="min-w-0">
                      <strong className="block text-sm font-medium text-ink">
                        {entry.title}
                      </strong>
                      <p className="mt-1 text-sm text-muted">
                        {entry.date ?? 'Date unavailable'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-pill border border-line bg-canvas px-2 py-1 text-xs font-semibold text-muted">
                      GitHub
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                GitHub updates are unavailable right now.
              </p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

function SurfaceCard({
  to,
  icon,
  title,
  detail,
}: {
  to: string
  icon: React.ReactNode
  title: string
  detail: string
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-canvas text-ink">
        {icon}
      </span>
      <span className="flex items-center gap-1 text-sm font-semibold text-ink">
        {title}
        <ArrowRight
          aria-hidden="true"
          size={14}
          weight="bold"
          className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
        />
      </span>
      <span className="text-sm leading-relaxed text-muted">{detail}</span>
    </Link>
  )
}
