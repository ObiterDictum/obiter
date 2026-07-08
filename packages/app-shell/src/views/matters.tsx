import { Link } from '@tanstack/react-router'
import { ArrowRight, Folders, MagnifyingGlass } from '@phosphor-icons/react'
import { Card, EmptyState } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useSuspenseQuery } from '@tanstack/react-query'
import { findMatterRecord, shellSnapshotQueryOptions } from '../fixtures'

/** Matters list — still the Phase 0 fixture view (M2 rewires to GET /api/matters). */
export function MattersRouteView({ platform }: { platform: AppPlatform }) {
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Matters</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Matters</h1>
        <p className="mt-1 text-sm text-muted">
          Private workspaces for legal documents, review state, deadlines, and artifacts.
        </p>
      </header>

      {data.matters.length > 0 ? (
        <section className="flex flex-col gap-2.5" aria-label="Matters">
          {data.matters.map((matter) => (
            <Link
              key={matter.id}
              to="/matters/$matterId"
              params={{ matterId: matter.id }}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-canvas text-ink">
                  <Folders aria-hidden="true" size={17} />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-ink">{matter.name}</strong>
                  <small className="mt-0.5 block truncate text-xs text-muted">
                    {matter.clientReference}
                    {matter.practiceArea ? ` · ${matter.practiceArea}` : ''}
                  </small>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-pill border border-line bg-canvas px-2 py-1 text-xs font-semibold text-muted">
                  {matter.status}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  size={15}
                  weight="bold"
                  className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                />
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <EmptyState
          title="No matters yet"
          body="Matter storage, uploads, redaction, drafting, and verification are planned surfaces. This page is ready for the first real matter workflow rather than placeholder records."
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/search"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-pressed"
              >
                <MagnifyingGlass aria-hidden="true" size={15} />
                Search sources
              </Link>
              <span className="rounded-pill border border-line bg-canvas px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-subtle">
                Create matter planned
              </span>
            </div>
          }
        />
      )}
    </div>
  )
}

/** Matter detail — still the Phase 0 fixture view (M2 rewires to real data). */
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
          action={
            <Link className="font-semibold text-brand hover:text-brand-pressed" to="/matters">
              Return to matters
            </Link>
          }
        />
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/matters"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-ink"
        >
          ← Matters
        </Link>
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
          {matter.clientReference}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{matter.name}</h1>
      </div>
      <Card>
        <p className="leading-relaxed text-muted">{matter.summary}</p>
      </Card>
    </div>
  )
}
