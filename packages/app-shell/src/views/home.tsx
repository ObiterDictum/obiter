import { Link } from '@tanstack/react-router'
import { PencilSimple, Upload } from '@phosphor-icons/react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import { PERSONAL_WORKSPACE_NAME } from '@obiter/contracts'
import { Skeleton, buttonClassName } from '@obiter/ui'
import { useEffect, useRef } from 'react'
import { useCurrentUser } from '../current-user'
import { matterDocumentsQueryOptions } from '../documents'
import { formatDate } from '../format'
import { useMattersList, type MatterRecord } from '../matters'
import { useRedactionRunsList } from '../redaction-runs'
import {
  useOrganisationVerificationRuns,
  useVerificationRunDocuments,
} from '../verification-runs'
import { PageScaffold } from '../page-scaffold'
import {
  buildAttentionItems,
  rankAttentionItems,
  summariseAttention,
} from './home-attention'
import { attentionSummaryText } from './home-attention-copy'
import { ATTENTION_LIMIT, AttentionSection } from './home-attention-list'
import { CreateMatterDialog } from './create-matter-dialog'
import { HomeEmpty } from './home-empty'
import {
  RecentDocumentsCard,
  YourMattersCard,
  type MatterSummary,
  type RecentDocument,
} from './home-rail'

/** The dashboard reads documents from this many recently updated matters. */
const DOCUMENT_MATTER_WINDOW = 6
/** How many rows each rail card shows. */
const RAIL_LIMIT = 4

/**
 * Home — the workspace queue. Every row is a real Verify finding, a redaction
 * run waiting for a decision, or a run that failed; the ranking says why one
 * outranks another (`home-attention.ts`). No activity, assignment or count is
 * invented.
 */
export function HomeRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const { data: me } = useCurrentUser()
  return <HomeDashboard me={me} />
}

function HomeDashboard({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient()
  const matters = useMattersList()
  const redactionRuns = useRedactionRunsList()
  // Always enabled, like the sidebar: the two share this cache entry, so Home
  // costs no extra request once the frame has loaded.
  const verification = useOrganisationVerificationRuns(true)
  const hasOrganisation = me.organisation != null
  const organisationName = me.organisation?.name ?? null
  const invalidatedCurrentUser = useRef(false)

  // Reading matters creates a personal workspace for an account without one.
  // `/api/me` is a suspense query, so it has to be re-read once to show the
  // organisation the API just made. Runs once, guarded by a ref.
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

  const activeMatters = (matters.data ?? [])
    .filter((matter) => matter.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const documentMatters = activeMatters.slice(0, DOCUMENT_MATTER_WINDOW)
  const documentQueries = useQueries({
    queries: documentMatters.map((matter) => ({
      ...matterDocumentsQueryOptions(matter.id),
      staleTime: 30_000,
    })),
  })

  const documentFilenames = new Map<string, string>()
  const documentCounts = new Map<string, number>()
  const recentDocuments: RecentDocument[] = []
  documentMatters.forEach((matter, index) => {
    const documents = documentQueries[index]?.data
    if (!documents) return
    documentCounts.set(matter.id, documents.length)
    for (const document of documents) {
      const version = document.currentVersion
      if (!version) continue
      documentFilenames.set(document.id, version.filename)
      recentDocuments.push({
        documentId: document.id,
        matterId: matter.id,
        matterName: matter.name,
        filename: version.filename,
        updatedAt: version.updatedAt,
      })
    }
  })
  recentDocuments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  // The run list carries document ids only. The recent runs' filenames come
  // from the same per-document boundary the Verify page reads; the window is
  // bounded so the dashboard never fans out across every run.
  const verificationRuns = verification.runs
  const identityRuns = [...verificationRuns]
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(
        a.completedAt ?? a.createdAt,
      ),
    )
    .slice(0, ATTENTION_LIMIT)
  const identities = useVerificationRunDocuments(identityRuns)
  for (const [documentId, identity] of identities) {
    if (identity.status === 'available') {
      documentFilenames.set(documentId, identity.filename)
    }
  }

  const matterSources = new Map(
    (matters.data ?? []).map((matter) => [
      matter.id,
      { name: matter.name, clientReference: matter.clientReference },
    ]),
  )
  const ranked = rankAttentionItems(
    buildAttentionItems({
      verificationRuns,
      redactionRuns: redactionRuns.data?.runs ?? [],
      documentFilenames,
      matters: matterSources,
    }),
  )
  const summary = summariseAttention(ranked)
  const attentionError = verification.isError
    ? verification.error.message
    : redactionRuns.isError
      ? redactionRuns.error.message
      : null
  const attentionLoading = verification.isPending || redactionRuns.isPending

  const mattersLoading = matters.isPending
  const mattersError = matters.isError
    ? 'Check your connection and try again.'
    : null
  const documentsLoading =
    matters.isPending || documentQueries.some((query) => query.isPending)
  const dataSettled =
    matters.isSuccess && !attentionLoading && !documentsLoading
  const empty =
    dataSettled &&
    (matters.data?.length ?? 0) === 0 &&
    ranked.length === 0 &&
    recentDocuments.length === 0

  const firstName = firstNameOf(me.user.name)
  const showNamingPrompt =
    me.user.role === 'owner' && organisationName === PERSONAL_WORKSPACE_NAME
  const matterSummaries = (list: MatterRecord[]): MatterSummary[] =>
    list.slice(0, RAIL_LIMIT).map((matter) => ({
      id: matter.id,
      name: matter.name,
      clientReference: matter.clientReference,
      updatedAt: matter.updatedAt,
      documentCount: documentCounts.get(matter.id) ?? null,
    }))

  return (
    <PageScaffold
      eyebrow={todayLabel(new Date())}
      title={
        empty
          ? `Welcome to Obiter, ${firstName}`
          : `${greetingForHour(new Date().getHours())}, ${firstName}`
      }
      description={
        <span className="flex flex-col gap-1">
          {empty ? (
            `${organisationName ?? 'Your workspace'} is ready. Start with a matter, or search the law first.`
          ) : attentionError ? (
            'Your open work could not be loaded. Open Verify or Redact to retry.'
          ) : attentionLoading ? (
            <Skeleton className="h-4 w-72" />
          ) : (
            attentionSummaryText(summary)
          )}
          {showNamingPrompt ? (
            <span className="text-caption">
              Your workspace still has its default name.{' '}
              <Link to="/settings" className="text-ink hover:text-brand">
                Name it in Settings
              </Link>
              .
            </span>
          ) : null}
        </span>
      }
      actions={
        empty ? undefined : (
          <>
            <CreateMatterDialog
              trigger="New matter"
              variant="secondary"
              size="md"
            />
            <Link
              to="/matters"
              className={buttonClassName({ variant: 'secondary' })}
            >
              <Upload size={16} aria-hidden /> Upload document
            </Link>
            <Link
              to="/redact"
              className={buttonClassName({ variant: 'ghost' })}
            >
              <PencilSimple size={16} aria-hidden /> Start redaction
            </Link>
          </>
        )
      }
    >
      {empty ? (
        <HomeEmpty />
      ) : (
        <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
          <AttentionSection
            items={ranked.slice(0, ATTENTION_LIMIT)}
            total={ranked.length}
            loading={attentionLoading}
            error={attentionError}
          />
          <aside
            aria-label="Recent work"
            // The rail is one column beside the queue (320px) and two columns when
            // the page is single-column, as the mock-up shows at 1024.
            className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] max-compact:grid-cols-1 wide:grid-cols-1"
          >
            <RecentDocumentsCard
              documents={recentDocuments.slice(0, RAIL_LIMIT)}
              loading={documentsLoading}
            />
            <YourMattersCard
              matters={matterSummaries(activeMatters)}
              loading={mattersLoading}
              error={mattersError}
              totalMatters={activeMatters.length}
            />
          </aside>
        </div>
      )}
    </PageScaffold>
  )
}

function firstNameOf(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? name
  if (!first) return name
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** "Monday 26 Oct 2026": one date style, with the weekday on the page head. */
function todayLabel(date: Date) {
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(
    date,
  )
  return `${weekday} ${formatDate(date.toISOString())}`
}
