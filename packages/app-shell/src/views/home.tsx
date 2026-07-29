import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Clock,
  Folders,
  MagnifyingGlass,
  PencilSimple,
  X,
} from '@phosphor-icons/react'
import { Button, Skeleton } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { changelogQueryOptions } from '../changelog'
import { useMattersList } from '../matters'
import { useCurrentUser } from '../current-user'

/**
 * Home — authenticated landing desk. Greeting + Continue / Attention / Active
 * matters lanes (marketing workspace demo structure), driven by real /api data.
 */
export function HomeRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const { data: me } = useCurrentUser()

  return (
    <OrganisationHome
      organisationName={me.organisation?.name ?? null}
      userName={me.user.name}
      hasOrganisation={Boolean(me.organisation)}
    />
  )
}

function OrganisationHome({
  organisationName,
  userName,
  hasOrganisation,
}: {
  organisationName: string | null
  userName: string
  hasOrganisation: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [homeSearch, setHomeSearch] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const matters = useMattersList()
  const { data: changelog } = useSuspenseQuery(changelogQueryOptions())
  const invalidatedCurrentUser = useRef(false)

  // Matters/Redact auto-provision a personal workspace; refresh /api/me once
  // so Settings picks up the new organisation without a hard reload.
  useEffect(() => {
    if (
      matters.isSuccess &&
      !hasOrganisation &&
      !invalidatedCurrentUser.current
    ) {
      invalidatedCurrentUser.current = true
      void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    }
  }, [matters.isSuccess, hasOrganisation, queryClient])

  const matterCount = matters.data?.length ?? 0
  const mattersDetail = matters.isLoading
    ? 'loading'
    : matters.isError
      ? 'error'
      : matterCount > 0
        ? 'count'
        : 'empty'
  const firstName = userName.split(' ')[0]
  const recentMatters = matters.data?.slice(0, 6) ?? []

  function handleHomeSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = homeSearch.trim()
    if (query) {
      window.sessionStorage.setItem('obiter.search.initialQuery', query)
    }
    void navigate({ to: '/search' })
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-end justify-between gap-4 border-b border-line px-6 py-5">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-medium text-subtle">
            {organisationName ?? 'No organisation yet'}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Welcome back, {firstName}
          </h1>
        </div>
        <button
          aria-label="Open product updates"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted transition-colors duration-200 hover:bg-raised hover:text-ink"
          type="button"
          onClick={() => setChangelogOpen(true)}
        >
          <Clock aria-hidden="true" size={15} />
          Updates
        </button>
      </header>

      <div className="flex flex-col gap-0">
        <section className="border-b border-line px-6 py-5" aria-label="Continue">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
            Continue
          </p>
          <form className="flex items-center gap-2" onSubmit={handleHomeSearch}>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 transition-[border-color] duration-200 focus-within:border-line-strong">
              <MagnifyingGlass
                aria-hidden="true"
                size={16}
                className="shrink-0 text-subtle"
              />
              <input
                id="home-search"
                className="min-h-[24px] min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
                value={homeSearch}
                onChange={(event) => setHomeSearch(event.target.value)}
                placeholder="Case name, citation, or keyword"
                type="search"
                aria-label="Search legal sources"
              />
            </div>
            <Button type="submit" size="sm">
              Search
            </Button>
          </form>
        </section>

        <section className="border-b border-line px-6 py-5" aria-label="Attention">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
            Attention
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <LaneLink
              to="/search"
              icon={<MagnifyingGlass size={16} aria-hidden />}
              title="Search judgments"
              detail="Stored corpus and Find Case Law"
            />
            <LaneLink
              to="/matters"
              icon={<Folders size={16} aria-hidden />}
              title="Matters"
              detail={
                mattersDetail === 'loading'
                  ? 'Loading…'
                  : mattersDetail === 'error'
                    ? 'Could not load — open to retry'
                    : mattersDetail === 'count'
                      ? `${matterCount} active`
                      : 'Create your first matter'
              }
            />
            <LaneLink
              to="/redact"
              icon={<PencilSimple size={16} aria-hidden />}
              title="Redaction"
              detail="Review runs and pending spans"
            />
          </div>
        </section>

        <section className="px-6 py-5" aria-label="Active matters">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-subtle">
              Active matters
            </p>
            <Link
              to="/matters"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:text-brand-pressed"
            >
              All matters
              <ArrowRight aria-hidden size={13} weight="bold" />
            </Link>
          </div>

          {mattersDetail === 'loading' ? (
            <div className="flex flex-col gap-1" aria-busy="true">
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          ) : mattersDetail === 'error' ? (
            <p className="text-sm text-muted">
              Your matters could not be loaded.{' '}
              <Link
                to="/matters"
                className="font-medium text-brand hover:text-brand-pressed"
              >
                Open Matters
              </Link>{' '}
              to retry.
            </p>
          ) : recentMatters.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {recentMatters.map((matter) => (
                <li key={matter.id}>
                  <Link
                    to="/matters/$matterId"
                    params={{ matterId: matter.id }}
                    className="group flex items-center justify-between gap-3 px-1 py-3 transition-colors duration-200 hover:bg-raised/50"
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
                      aria-hidden
                      size={14}
                      weight="bold"
                      className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              No matters yet.{' '}
              <Link
                to="/matters"
                className="font-medium text-brand hover:text-brand-pressed"
              >
                Create one
              </Link>
              .
            </p>
          )}
        </section>
      </div>

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
          <section className="relative mt-16 w-full max-w-[560px] rounded-[0.85rem] border border-line-strong bg-raised p-5 shadow-lg">
            <header className="mb-4 flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-medium text-subtle">
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
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
                    <span className="shrink-0 rounded-md border border-line bg-canvas px-2 py-1 text-xs font-medium text-muted">
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

function LaneLink({
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
      className="group flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors duration-200 hover:bg-raised"
    >
      <span className="mt-0.5 text-muted group-hover:text-ink">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-muted">{detail}</span>
      </span>
    </Link>
  )
}
