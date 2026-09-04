import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Folders,
  MagnifyingGlass,
  Newspaper,
  PencilSimple,
  Plus,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { Skeleton, cn } from '@obiter/ui'
import {
  PERSONAL_WORKSPACE_NAME,
  type AppPlatform,
  type RedactionRunStatus,
} from '@obiter/contracts'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  useQueries,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { changelogQueryOptions } from '../changelog'
import {
  matterDocumentsQueryOptions,
  type DocumentStatus,
  type MatterDocumentRecord,
} from '../documents'
import { useMattersList, type MatterRecord } from '../matters'
import { useCurrentUser } from '../current-user'
import {
  provisionPendingOrganisation,
  readPendingOrganisationName,
} from '../pending-organisation'
import {
  attentionRunLabel,
  isAttentionRun,
  useRedactionRunsList,
  type RedactionRunListItem,
} from '../redaction-runs'
import { getRecentLegalSearches } from './LegalSearchView'
import {
  readWorkspaceLastPlace,
  type WorkspaceLastPlace,
} from '../workspace-continuity'

/** Desk list row — hover stays inside the column so truncate doesn’t kiss the rule. */
const deskRowClass =
  'group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-[background-color] duration-150 hover:bg-raised'

/**
 * Home — useful workspace dashboard. Real queue, resume, pipeline, continuity,
 * and case-law entry. No invented activity.
 */
export function HomeRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const { data: me } = useCurrentUser()
  const queryClient = useQueryClient()
  const provisionedPending = useRef(false)

  // Verification-link landings bypass the sign-in view, so the sign-up
  // organisation name is claimed here instead. Either path converges: the
  // POST wins while still org-less, otherwise the fresh default workspace
  // is renamed to the typed name.
  useEffect(() => {
    if (provisionedPending.current || !readPendingOrganisationName()) return
    provisionedPending.current = true
    void provisionPendingOrganisation().then((changed) => {
      if (changed)
        void queryClient.invalidateQueries({ queryKey: ['current-user'] })
    })
  }, [queryClient])

  return (
    <OrganisationHome
      organisationName={me.organisation?.name ?? null}
      userName={me.user.name}
      hasOrganisation={Boolean(me.organisation)}
      showNamingPrompt={
        me.user.role === 'owner' &&
        me.organisation?.name === PERSONAL_WORKSPACE_NAME
      }
    />
  )
}

function OrganisationHome({
  organisationName,
  userName,
  hasOrganisation,
  showNamingPrompt,
}: {
  organisationName: string | null
  userName: string
  hasOrganisation: boolean
  showNamingPrompt: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [homeSearch, setHomeSearch] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const matters = useMattersList()
  const runsQuery = useRedactionRunsList()
  const { data: changelog } = useSuspenseQuery(changelogQueryOptions())
  const invalidatedCurrentUser = useRef(false)

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

  const runs = runsQuery.data?.runs ?? []
  const activeMatters = useMemo(
    () =>
      (matters.data ?? [])
        .filter((matter) => matter.status === 'active')
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [matters.data],
  )

  const mattersDetail = matters.isLoading
    ? 'loading'
    : matters.isError
      ? 'error'
      : activeMatters.length > 0
        ? 'count'
        : 'empty'

  const attentionRuns = useMemo(
    () =>
      runs
        .filter((run) => isAttentionRun(run.status))
        .sort(
          (a, b) => attentionPriority(a.status) - attentionPriority(b.status),
        ),
    [runs],
  )

  const recentRuns = useMemo(
    () =>
      runs
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 6),
    [runs],
  )

  const pipeline = useMemo(() => countPipeline(runs), [runs])

  const pendingByMatter = useMemo(() => {
    const map = new Map<string, { count: number; unreviewed: number }>()
    for (const run of runs) {
      if (!run.matterId || !isAttentionRun(run.status)) continue
      const current = map.get(run.matterId) ?? { count: 0, unreviewed: 0 }
      current.count += 1
      current.unreviewed += run.summary?.unreviewedCount ?? 0
      map.set(run.matterId, current)
    }
    return map
  }, [runs])

  const matterSlice = activeMatters.slice(0, 5)
  const documentQueries = useQueries({
    queries: matterSlice.map((matter) => ({
      ...matterDocumentsQueryOptions(matter.id),
      staleTime: 30_000,
    })),
  })

  const docsByMatter = useMemo(() => {
    const map = new Map<
      string,
      { total: number; attention: number; loading: boolean }
    >()
    matterSlice.forEach((matter, index) => {
      const query = documentQueries[index]
      const docs = query?.data ?? []
      const attention = docs.filter((doc) =>
        isDocumentInPlay(doc.currentVersion?.documentStatus),
      ).length
      map.set(matter.id, {
        total: docs.length,
        attention,
        loading: Boolean(query?.isLoading),
      })
    })
    return map
  }, [documentQueries, matterSlice])

  const documentsInPlay = useMemo(() => {
    const items: DocumentInPlay[] = []
    matterSlice.forEach((matter, index) => {
      const docs = (documentQueries[index]?.data ??
        []) as MatterDocumentRecord[]
      for (const doc of docs) {
        const status = doc.currentVersion?.documentStatus
        if (!isDocumentInPlay(status) || !status) continue
        items.push({
          documentId: doc.id,
          matterId: matter.id,
          matterName: matter.name,
          filename: doc.currentVersion?.filename ?? doc.logicalKey,
          status,
          updatedAt: doc.currentVersion?.updatedAt ?? doc.updatedAt,
        })
      }
    })
    return items
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 6)
  }, [documentQueries, matterSlice])

  const showRedactionColumn =
    runsQuery.isLoading || attentionRuns.length > 0 || recentRuns.length > 0

  const documentTotal = useMemo(() => {
    let total = 0
    let loading = false
    for (const stats of docsByMatter.values()) {
      if (stats.loading) loading = true
      total += stats.total
    }
    return { total, loading }
  }, [docsByMatter])

  const redactionUsage = useMemo(() => {
    let spans = 0
    let accepted = 0
    let reviewed = 0
    let unreviewed = 0
    for (const run of runs) {
      const summary = run.summary
      if (!summary) continue
      spans += summary.totalSpans ?? 0
      reviewed += summary.reviewedCount ?? 0
      unreviewed += summary.unreviewedCount ?? 0
      const decisions = summary.byDecision
      if (decisions) {
        accepted += (decisions.accept ?? 0) + (decisions.override_redact ?? 0)
      }
    }
    return { spans, accepted, reviewed, unreviewed }
  }, [runs])

  const unreviewedTotal = redactionUsage.unreviewed
  const failedCount = pipeline.failed
  const displayName = formatDisplayName(userName.split(' ')[0] ?? userName)
  const recentSearches =
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage)

  const lastPlace = useMemo(() => {
    if (typeof window === 'undefined') return null
    const raw = readWorkspaceLastPlace(window.sessionStorage)
    if (!raw) return null
    return enrichLastPlace(raw, activeMatters, runs, recentSearches)
  }, [activeMatters, runs, recentSearches])

  function handleHomeSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    goSearch(homeSearch.trim())
  }

  function goSearch(query: string) {
    if (query) {
      window.sessionStorage.setItem('obiter.search.initialQuery', query)
    }
    void navigate({ to: '/search' })
  }

  function openRecentSearch(query: string) {
    goSearch(query)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-[76rem] flex-1 flex-col px-6 py-5 md:px-8">
        {/* Identity band */}
        <header className="flex flex-col gap-2 pb-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
                {organisationName ?? 'No organisation yet'}
                <span className="mx-2 text-line-strong">·</span>
                <span className="normal-case tracking-normal text-muted">
                  {formatDeskDate(new Date())}
                </span>
              </p>
              <h1 className="mt-1 text-xl leading-none font-semibold tracking-tight text-ink">
                {greetingForHour(new Date().getHours())}, {displayName}
              </h1>
              {lastPlace ? <ResumeStrip place={lastPlace} /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px]">
              <Stat
                label="Matters"
                value={
                  mattersDetail === 'loading'
                    ? '…'
                    : mattersDetail === 'error'
                      ? '—'
                      : String(activeMatters.length)
                }
              />
              <Stat
                label="Needs you"
                value={runsQuery.isLoading ? '…' : String(attentionRuns.length)}
                tone={attentionRuns.length > 0 ? 'warn' : 'neutral'}
              />
              <Stat
                label="Unreviewed"
                value={runsQuery.isLoading ? '…' : String(unreviewedTotal)}
                tone={unreviewedTotal > 0 ? 'warn' : 'neutral'}
              />
              {failedCount > 0 ? (
                <Stat
                  label="Failed"
                  value={String(failedCount)}
                  tone="danger"
                />
              ) : null}
              <button
                aria-label="Open product updates"
                title="Product updates"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
                type="button"
                onClick={() => setChangelogOpen(true)}
              >
                <Newspaper size={15} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {showNamingPrompt ? (
          <p className="mb-5 rounded-md border border-line bg-raised px-4 py-3 text-sm text-muted">
            Your workspace still has its default name.{' '}
            <Link
              to="/settings"
              className="font-medium text-brand hover:text-brand-pressed"
            >
              Name it in Settings
            </Link>
            .
          </p>
        ) : null}

        {/* Command + work desk */}
        <div className="flex flex-col border-t border-line pt-5">
          <form
            aria-label="Search case law"
            className="mb-5 flex w-full flex-col gap-2"
            onSubmit={handleHomeSearch}
          >
            <div className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <MagnifyingGlass
                aria-hidden
                size={15}
                className="shrink-0 text-subtle"
              />
              <input
                id="home-search"
                className="min-h-[24px] min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
                value={homeSearch}
                onChange={(event) => setHomeSearch(event.target.value)}
                placeholder="Act, citation, party, or point of law"
                type="search"
                aria-label="Search legal sources"
              />
              <button
                className="inline-flex h-7 shrink-0 items-center rounded-md bg-brand px-2.5 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-pressed"
                type="submit"
              >
                Search
              </button>
            </div>
            {recentSearches.length > 0 ? (
              <div
                aria-label="Recent searches"
                className="flex flex-wrap gap-1.5"
              >
                {recentSearches.slice(0, 6).map((query) => (
                  <button
                    key={query}
                    type="button"
                    onClick={() => openRecentSearch(query)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-ink"
                    title={query}
                  >
                    <MagnifyingGlass
                      size={12}
                      className="shrink-0 text-subtle"
                      aria-hidden
                    />
                    <span className="min-w-0 truncate">{query}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <QuickStart to="/matters" icon={Plus} label="New matter" />
              <QuickStart
                to="/redact"
                icon={PencilSimple}
                label="Start redaction"
              />
            </div>
          </form>

          {/* Work desk — redact column only when there is real activity */}
          <div
            className={cn(
              'grid grid-cols-1 border-t border-line',
              showRedactionColumn &&
                'lg:grid-cols-2 lg:divide-x lg:divide-line',
            )}
          >
            <section
              aria-label="Your work"
              className={cn('min-w-0 py-4', showRedactionColumn && 'lg:pr-8')}
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
                  Your work
                </h2>
                <Link
                  to="/matters"
                  className="text-[12px] font-medium text-brand hover:text-brand-pressed"
                >
                  All matters
                </Link>
              </div>

              {attentionRuns.length > 0 ? (
                <div className="mb-4">
                  <SectionHeading
                    title="Needs you"
                    action={
                      <Link
                        to="/redact"
                        className="text-[12px] font-medium text-brand hover:text-brand-pressed"
                      >
                        All runs
                      </Link>
                    }
                  />
                  {runsQuery.isLoading ? (
                    <StackSkeletons count={2} />
                  ) : (
                    <ul className="flex flex-col">
                      {attentionRuns.slice(0, 4).map((run) => (
                        <li key={run.id}>
                          <AttentionRow run={run} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {documentsInPlay.length > 0 ? (
                <div className="mb-4">
                  <SectionHeading title="Documents in play" />
                  <ul className="flex flex-col">
                    {documentsInPlay.map((doc) => (
                      <li key={doc.documentId}>
                        <DocumentInPlayRow doc={doc} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <SectionHeading title="Active matters" />
              {mattersDetail === 'loading' ? (
                <div aria-busy="true">
                  <StackSkeletons count={3} />
                  <span className="sr-only">Loading…</span>
                </div>
              ) : mattersDetail === 'error' ? (
                <p className="py-1 text-sm text-muted">
                  Your matters could not be loaded.{' '}
                  <Link
                    to="/matters"
                    className="font-medium text-brand hover:text-brand-pressed"
                  >
                    Open Matters
                  </Link>{' '}
                  to retry.
                </p>
              ) : matterSlice.length > 0 ? (
                <ul className="flex flex-col">
                  {matterSlice.map((matter) => (
                    <li key={matter.id}>
                      <MatterRow
                        matter={matter}
                        workload={pendingByMatter.get(matter.id)}
                        documents={docsByMatter.get(matter.id)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyMatters />
              )}
            </section>

            {showRedactionColumn ? (
              <section
                aria-label="Redaction"
                className="min-w-0 border-t border-line py-4 lg:border-t-0 lg:pl-8"
              >
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
                    Redaction
                  </h2>
                  <Link
                    to="/redact"
                    className="text-[12px] font-medium text-brand hover:text-brand-pressed"
                  >
                    Open redact
                  </Link>
                </div>

                {runsQuery.isLoading ? (
                  <StackSkeletons count={2} />
                ) : (
                  <>
                    <PipelineChips pipeline={pipeline} />
                    <ul className="mt-3 flex flex-col border-t border-line pt-2">
                      {recentRuns.slice(0, 5).map((run) => (
                        <li key={run.id}>
                          <Link
                            to="/redact/$runId"
                            params={{ runId: run.id }}
                            className={deskRowClass}
                          >
                            <ActivityIcon status={run.status} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-ink">
                                {run.sourceFilename}
                              </span>
                              <span className="block truncate text-[11px] text-muted">
                                {attentionRunLabel(run.status)} ·{' '}
                                {formatRelativeTime(run.updatedAt)}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ) : null}
          </div>

          <WorkspaceUsage
            matters={
              mattersDetail === 'loading'
                ? null
                : mattersDetail === 'error'
                  ? undefined
                  : activeMatters.length
            }
            documents={documentTotal.loading ? null : documentTotal.total}
            runs={runsQuery.isLoading ? null : runs.length}
            finalized={runsQuery.isLoading ? null : pipeline.finalized}
            spans={runsQuery.isLoading ? null : redactionUsage.spans}
            accepted={runsQuery.isLoading ? null : redactionUsage.accepted}
            unreviewed={runsQuery.isLoading ? null : redactionUsage.unreviewed}
          />
        </div>
      </div>

      {changelogOpen ? (
        <ChangelogDrawer
          entries={changelog.entries}
          onClose={() => setChangelogOpen(false)}
        />
      ) : null}
    </div>
  )
}

function SectionHeading({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {action}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warn' | 'danger'
}) {
  return (
    <p className="text-[12px] text-muted">
      {label}{' '}
      <span
        className={cn(
          'font-mono text-[12px] font-medium tabular-nums',
          tone === 'warn'
            ? 'text-warning'
            : tone === 'danger'
              ? 'text-danger'
              : 'text-ink',
        )}
      >
        {value}
      </span>
    </p>
  )
}

function ResumeStrip({ place }: { place: WorkspaceLastPlace }) {
  return (
    <Link
      to={place.path}
      className="group mt-1.5 inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-ink"
    >
      <span className="shrink-0">Continue</span>
      <span className="truncate font-medium text-ink group-hover:text-brand">
        {place.label}
      </span>
      <ArrowRight
        size={11}
        weight="bold"
        className="shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  )
}

function WorkspaceUsage({
  matters,
  documents,
  runs,
  finalized,
  spans,
  accepted,
  unreviewed,
}: {
  matters: number | null | undefined
  documents: number | null
  runs: number | null
  finalized: number | null
  spans: number | null
  accepted: number | null
  unreviewed: number | null
}) {
  const items = [
    { label: 'Matters', value: formatUsageValue(matters) },
    { label: 'Documents', value: formatUsageValue(documents) },
    { label: 'Redaction runs', value: formatUsageValue(runs) },
    { label: 'Finalized', value: formatUsageValue(finalized) },
    { label: 'Spans detected', value: formatUsageValue(spans) },
    { label: 'Accepted to redact', value: formatUsageValue(accepted) },
    { label: 'Unreviewed spans', value: formatUsageValue(unreviewed) },
  ]

  return (
    <section
      aria-label="Workspace usage"
      className="border-t border-line pt-4 pb-1"
    >
      <p className="mb-3 text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
        Workspace
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-7">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[11px] text-subtle">{item.label}</dt>
            <dd className="mt-0.5 font-mono text-[15px] font-medium tabular-nums text-ink">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function formatUsageValue(value: number | null | undefined) {
  if (value === null) return '…'
  if (value === undefined) return '—'
  return String(value)
}

function DocumentInPlayRow({ doc }: { doc: DocumentInPlay }) {
  return (
    <Link
      to="/matters/$matterId/documents/$documentId"
      params={{ matterId: doc.matterId, documentId: doc.documentId }}
      className={deskRowClass}
    >
      <FileText size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {doc.filename}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {documentStatusLabel(doc.status)} · {doc.matterName} ·{' '}
          {formatRelativeTime(doc.updatedAt)}
        </span>
      </span>
    </Link>
  )
}

function PipelineChips({
  pipeline,
}: {
  pipeline: ReturnType<typeof countPipeline>
}) {
  const chips = [
    { label: 'Ready', value: pipeline.ready, tone: 'warn' as const },
    { label: 'In review', value: pipeline.reviewing, tone: 'neutral' as const },
    { label: 'Detecting', value: pipeline.detecting, tone: 'neutral' as const },
    {
      label: 'Finalized',
      value: pipeline.finalized,
      tone: 'success' as const,
    },
    { label: 'Failed', value: pipeline.failed, tone: 'danger' as const },
  ]

  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
      {chips.map((chip) => (
        <span key={chip.label}>
          {chip.label}{' '}
          <span
            className={cn(
              'font-mono font-medium tabular-nums',
              chip.tone === 'warn'
                ? 'text-warning'
                : chip.tone === 'danger'
                  ? 'text-danger'
                  : chip.tone === 'success'
                    ? 'text-success'
                    : 'text-ink',
            )}
          >
            {chip.value}
          </span>
        </span>
      ))}
    </p>
  )
}

function AttentionRow({ run }: { run: RedactionRunListItem }) {
  const unreviewed = run.summary?.unreviewedCount
  const failed = run.status === 'failed'
  return (
    <Link
      to="/redact/$runId"
      params={{ runId: run.id }}
      className={cn(deskRowClass, 'items-start')}
    >
      {failed ? (
        <WarningCircle
          size={14}
          className="mt-0.5 shrink-0 text-danger"
          aria-hidden
        />
      ) : run.status === 'detecting' || run.status === 'pending' ? (
        <Clock size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      ) : (
        <PencilSimple
          size={14}
          className="mt-0.5 shrink-0 text-warning"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {run.sourceFilename}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {attentionRunLabel(run.status)}
          {typeof unreviewed === 'number' && unreviewed > 0
            ? ` · ${unreviewed} unreviewed`
            : null}
          {' · '}
          {formatRelativeTime(run.updatedAt)}
        </span>
      </span>
    </Link>
  )
}

function MatterRow({
  matter,
  workload,
  documents,
}: {
  matter: MatterRecord
  workload?: { count: number; unreviewed: number }
  documents?: { total: number; attention: number; loading: boolean }
}) {
  return (
    <Link
      to="/matters/$matterId"
      params={{ matterId: matter.id }}
      className={deskRowClass}
    >
      <Folders size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">
            {matter.name}
          </span>
          {workload && workload.count > 0 ? (
            <span className="font-mono text-[10px] text-warning">
              {workload.count} run{workload.count === 1 ? '' : 's'}
            </span>
          ) : null}
          {documents && !documents.loading && documents.attention > 0 ? (
            <span className="font-mono text-[10px] text-danger">
              {documents.attention} doc
              {documents.attention === 1 ? '' : 's'}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {documents?.loading
            ? 'Loading…'
            : documents
              ? `${documents.total} doc${documents.total === 1 ? '' : 's'}`
              : null}
          {matter.clientReference ? ` · ${matter.clientReference}` : ''}
          {' · '}
          {formatRelativeTime(matter.updatedAt)}
        </span>
      </span>
    </Link>
  )
}

function ActivityIcon({ status }: { status: RedactionRunListItem['status'] }) {
  if (status === 'finalized') {
    return (
      <CheckCircle size={13} className="shrink-0 text-success" aria-hidden />
    )
  }
  if (status === 'failed') {
    return (
      <WarningCircle size={13} className="shrink-0 text-danger" aria-hidden />
    )
  }
  return <PencilSimple size={13} className="shrink-0 text-subtle" aria-hidden />
}

function EmptyMatters() {
  return (
    <p className="py-1 text-sm text-muted">
      No active matters.{' '}
      <Link
        to="/matters"
        className="font-medium text-brand hover:text-brand-pressed"
      >
        Create one
      </Link>
      .<span className="sr-only">Create your first matter</span>
    </p>
  )
}

function StackSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full rounded-md" />
      ))}
    </div>
  )
}

function QuickStart({
  to,
  icon: Icon,
  label,
}: {
  to: string
  icon: typeof Plus
  label: string
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
    >
      <Icon size={13} aria-hidden />
      {label}
    </Link>
  )
}

function ChangelogDrawer({
  entries,
  onClose,
}: {
  entries: Array<{ title: string; url: string; date?: string | null }>
  onClose: () => void
}) {
  return (
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
        onClick={onClose}
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
            onClick={onClose}
          >
            <X aria-hidden size={17} />
          </button>
        </header>
        {entries.length > 0 ? (
          <div className="flex flex-col divide-y divide-line">
            {entries.slice(0, 8).map((entry) => (
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
  )
}

function countPipeline(runs: RedactionRunListItem[]) {
  const counts = {
    ready: 0,
    reviewing: 0,
    detecting: 0,
    finalized: 0,
    failed: 0,
  }
  for (const run of runs) {
    switch (run.status) {
      case 'ready_for_review':
        counts.ready += 1
        break
      case 'reviewing':
        counts.reviewing += 1
        break
      case 'pending':
      case 'detecting':
        counts.detecting += 1
        break
      case 'finalized':
        counts.finalized += 1
        break
      case 'failed':
        counts.failed += 1
        break
      default:
        break
    }
  }
  return counts
}

interface DocumentInPlay {
  documentId: string
  matterId: string
  matterName: string
  filename: string
  status: DocumentStatus
  updatedAt: string
}

function isDocumentInPlay(
  status: DocumentStatus | null | undefined,
): status is DocumentStatus {
  return (
    status === 'queued' ||
    status === 'processing' ||
    status === 'failed' ||
    status === 'needs_review'
  )
}

function documentStatusLabel(status: DocumentStatus) {
  switch (status) {
    case 'needs_review':
      return 'Needs review'
    case 'processing':
      return 'Processing'
    case 'queued':
      return 'Queued'
    case 'failed':
      return 'Failed'
    case 'ready':
      return 'Ready'
    default:
      return status
  }
}

function enrichLastPlace(
  place: WorkspaceLastPlace,
  matters: MatterRecord[],
  runs: RedactionRunListItem[],
  recentSearches: string[],
): WorkspaceLastPlace {
  if (place.kind === 'matter' && place.detail) {
    const matter = matters.find((item) => item.id === place.detail)
    if (matter) {
      const detail =
        matter.clientReference &&
        matter.clientReference.toLowerCase() !== matter.name.toLowerCase()
          ? matter.clientReference
          : matter.primaryJurisdiction || undefined
      return {
        ...place,
        label: matter.name,
        detail,
      }
    }
  }
  if (place.kind === 'redact' && place.detail) {
    const run = runs.find((item) => item.id === place.detail)
    if (run) {
      return {
        ...place,
        label: run.sourceFilename,
        detail: attentionRunLabel(run.status),
      }
    }
  }
  if (place.kind === 'search') {
    const recent = recentSearches[0]?.trim()
    // Skip stub queries (“be”, single tokens) — keep the stored path label.
    if (recent && recent.length >= 12) {
      return {
        ...place,
        path: '/search',
        label: recent,
        detail: 'Case law',
      }
    }
  }
  return place
}

function formatDisplayName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return name
  if (trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase()) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }
  return trimmed
}

function attentionPriority(status: RedactionRunStatus) {
  switch (status) {
    case 'failed':
      return 0
    case 'ready_for_review':
      return 1
    case 'reviewing':
      return 2
    case 'detecting':
      return 3
    case 'pending':
      return 4
    default:
      return 5
  }
}

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatDeskDate(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function formatRelativeTime(iso: string) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'recently'
  const deltaSec = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(deltaSec)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (abs < 60) return rtf.format(deltaSec, 'second')
  const mins = Math.round(deltaSec / 60)
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute')
  const hours = Math.round(deltaSec / 3600)
  if (Math.abs(hours) < 48) return rtf.format(hours, 'hour')
  const days = Math.round(deltaSec / 86400)
  return rtf.format(days, 'day')
}
