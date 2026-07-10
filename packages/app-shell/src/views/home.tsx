import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Clock, Folders, MagnifyingGlass, Sparkle, X } from '@phosphor-icons/react'
import type { AppPlatform } from '@obiter/contracts'
import { useState, type FormEvent } from 'react'
import { changelogQueryOptions } from '../changelog'
import {
  canSeeDevelopmentStatus,
  shellSnapshotQueryOptions,
} from '../fixtures'
import { useCurrentUser } from '../current-user'
import { useSuspenseQuery } from '@tanstack/react-query'

/**
 * Home — landing surface. Greeting + a single hero search entry that routes to
 * /search, then a tidy "live today" shortcuts list. Still fixture-backed (M2
 * rewires to real data); structure is the part that matters here.
 */
export function HomeRouteView({ platform }: { platform: AppPlatform }) {
  const navigate = useNavigate()
  const [homeSearch, setHomeSearch] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const { data: me } = useCurrentUser()
  const { data: changelog } = useSuspenseQuery(changelogQueryOptions())
  const activeMilestone = data.milestones.find((milestone) => milestone.status === 'active')
  const matterCount = data.matters.length
  const firstName = me.user.name.split(' ')[0]

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
            {data.organisation.name}
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
      <form
        className="group flex flex-col gap-2"
        onSubmit={handleHomeSearch}
      >
        <label className="text-sm font-medium text-muted" htmlFor="home-search">
          Search legal sources
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 transition-colors focus-within:border-brand">
          <MagnifyingGlass aria-hidden="true" size={18} className="text-subtle" />
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
              matterCount > 0
                ? `${matterCount} open matter ${matterCount === 1 ? 'workspace' : 'workspaces'}.`
                : 'Matter workspaces land here once created.'
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

      {/* What's coming — quiet, honest about planned surfaces. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
          In progress
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          Redaction, verification, drafting, research, and deadlines are planned surfaces on the
          roadmap. The shell is ready for each as it lands.
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
                <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Product updates</p>
                <h2 className="text-lg font-semibold text-ink" id="workspace-changelog-title">
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
                      <strong className="block text-sm font-medium text-ink">{entry.title}</strong>
                      <p className="mt-1 text-sm text-muted">{entry.date ?? 'Date unavailable'}</p>
                    </div>
                    <span className="shrink-0 rounded-pill border border-line bg-canvas px-2 py-1 text-xs font-semibold text-muted">
                      GitHub
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">GitHub updates are unavailable right now.</p>
            )}
            {activeMilestone && canSeeDevelopmentStatus(me) ? (
              <section className="mt-4 border-t border-line pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Development status</p>
                <h3 className="mt-1 text-base font-semibold text-ink">{activeMilestone.label}</h3>
                <p className="mt-2 text-sm text-muted">{activeMilestone.detail}</p>
              </section>
            ) : null}
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
