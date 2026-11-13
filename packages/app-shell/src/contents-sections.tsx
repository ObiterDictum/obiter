import { Link } from '@tanstack/react-router'
import { Skeleton, cn } from '@obiter/ui'
import { CaretRight, FileText, ShieldCheck } from '@obiter/ui/icons/shell'
import type { ReactNode } from 'react'
import { useShellContents } from './shell-contents'
import type { MatterStatusFilter } from './views/matters-rows'
import { useMattersList } from './matters'
import { useMatterDocuments } from './documents'
import { attentionRunLabel, useRedactionRunsList } from './redaction-runs'
import { latestRunsPerDocument, openWorkForRun } from './open-work'
import { useOrganisationVerificationRuns } from './verification-runs'
import { recentMatters } from './sidebar-counts'
import { documentIdFromPath } from './navigation'
import {
  documentTab,
  redactTab,
  verifyTab,
  type MatterTab,
} from './matter-tabs'
import { useMatterPreviewRef } from './matter-preview'
import { useCurrentUser } from './current-user'
import { SETTINGS_SECTIONS, useSettingsSection } from './settings-sections'
import { getRecentLegalSearches } from './legal-search-recents'
import type { RedactionRunStatus, VerificationRun } from '@obiter/contracts'

const ROWS_PER_GROUP = 6

export const rowClass = (current?: boolean) =>
  cn(
    'flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-meta',
    current
      ? 'bg-fill text-ink'
      : 'text-muted transition-colors duration-150 hover:bg-hover hover:text-ink',
  )

function Group({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-px pb-2">
      <h3 className="flex items-center justify-between px-2 pt-2 pb-1 text-caption text-muted">
        {title}
        {count ? (
          <span aria-hidden className="tabular-nums text-subtle">
            {count}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-caption text-subtle">{children}</p>
}

function RowLink({
  to,
  params,
  current,
  icon,
  label,
  meta,
  tone,
  preview,
}: {
  to: string
  params?: Record<string, string>
  current?: boolean
  icon?: ReactNode
  label: string
  meta?: string
  tone?: 'danger' | 'warning' | 'info'
  preview?: MatterTab
}) {
  const previewRef = useMatterPreviewRef()
  return (
    <Link
      to={to}
      params={params}
      className={rowClass(current)}
      onClick={(event) => {
        if (!preview || !previewRef) return
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return
        previewRef.current?.(preview)
      }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span
          className={cn(
            'shrink-0 text-caption',
            tone === 'danger'
              ? 'text-danger'
              : tone === 'warning'
                ? 'text-warning'
                : tone === 'info'
                  ? 'text-info'
                  : 'text-subtle',
          )}
        >
          {meta}
        </span>
      ) : null}
    </Link>
  )
}

export function MattersListContents() {
  const matters = useMattersList().data ?? []
  const recent = recentMatters(matters)

  return (
    <div className="flex flex-col">
      <Group title="Filters">
        <MattersStatusFilter />
      </Group>
      <Group title="Recent matters">
        {recent.length === 0 ? (
          <Note>No matters yet.</Note>
        ) : (
          recent.map((matter) => (
            <RowLink
              key={matter.id}
              to="/matters/$matterId"
              params={{ matterId: matter.id }}
              label={matter.name}
              meta={matter.clientReference ?? undefined}
            />
          ))
        )}
      </Group>
    </div>
  )
}

function MattersStatusFilter() {
  const { mattersStatus, setMattersStatus } = useShellContents()
  const options: Array<{ id: MatterStatusFilter; label: string }> = [
    { id: 'active', label: 'Active' },
    { id: 'archived', label: 'Archived' },
    { id: 'all', label: 'All' },
  ]
  return (
    <div role="group" aria-label="Filter matters" className="flex gap-1 px-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={mattersStatus === option.id}
          onClick={() => setMattersStatus(option.id)}
          className={cn(
            'h-7 flex-1 rounded-md text-caption transition-colors duration-150',
            mattersStatus === option.id
              ? 'bg-fill text-ink'
              : 'text-muted hover:bg-hover hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function MatterContents({
  matterId,
  pathname,
}: {
  matterId: string
  pathname: string
}) {
  const documents = useMatterDocuments(matterId)
  const verificationRuns = useOrganisationVerificationRuns(true).runs
  const redactionRuns = useRedactionRunsList().data?.runs ?? []
  const currentDocumentId = documentIdFromPath(pathname)

  const checks = verificationRuns
    .filter((run) => run.matterId === matterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const redactions = redactionRuns
    .filter((run) => run.matterId === matterId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <div className="flex flex-col">
      <Group title="Documents" count={documents.data?.length}>
        {documents.isPending ? (
          <Skeleton className="mx-2 my-1 h-6" />
        ) : !documents.data || documents.data.length === 0 ? (
          <Note>No documents yet.</Note>
        ) : (
          documents.data.map((document) => {
            const filename =
              document.currentVersion?.filename ?? document.logicalKey
            return (
              <RowLink
                key={document.id}
                to="/matters/$matterId/documents/$documentId"
                params={{ matterId, documentId: document.id }}
                current={document.id === currentDocumentId}
                preview={documentTab(document.id, filename)}
                icon={
                  <FileText
                    size={14}
                    aria-hidden
                    className="shrink-0 text-subtle"
                  />
                }
                label={filename}
              />
            )
          })
        )}
      </Group>

      {checks.length > 0 || redactions.length > 0 ? (
        <Group title="Checks" count={checks.length + redactions.length}>
          {checks.slice(0, ROWS_PER_GROUP).map((run) => (
            <RowLink
              key={run.id}
              to="/matters/$matterId/verify"
              params={{ matterId }}
              preview={verifyTab()}
              icon={
                <ShieldCheck
                  size={14}
                  aria-hidden
                  className="shrink-0 text-subtle"
                />
              }
              label={`Verify · ${verificationTag(run)}`}
              meta={verificationMeta(run)}
              tone={verificationTone(run)}
            />
          ))}
          {redactions.slice(0, ROWS_PER_GROUP).map((run) => (
            <RowLink
              key={run.id}
              to="/matters/$matterId/redact/$runId"
              params={{ matterId, runId: run.id }}
              preview={redactTab(run.id, run.sourceFilename)}
              icon={
                <FileText
                  size={14}
                  aria-hidden
                  className="shrink-0 text-subtle"
                />
              }
              label={`Redact · ${run.sourceFilename}`}
              meta={attentionRunLabel(run.status)}
            />
          ))}
        </Group>
      ) : null}
    </div>
  )
}

function verificationTag(run: VerificationRun) {
  if (run.status === 'failed') return 'failed'
  if (run.status === 'queued') return 'queued'
  if (run.status === 'running') return 'running'
  if (run.summary.flaggedCount > 0) return 'flagged'
  if (run.summary.reviewRequiredCount > 0) return 'needs review'
  if (run.summary.notCheckedCount > 0) return 'not checked'
  return 'matches'
}

function verificationMeta(run: VerificationRun) {
  if (run.status !== 'completed') return undefined
  const open = openWorkForRun(run)
  return open > 0 ? String(open) : undefined
}

function verificationTone(run: VerificationRun): 'danger' | 'warning' {
  return run.summary.flaggedCount > 0 ? 'danger' : 'warning'
}

function verifyGroups(runs: VerificationRun[]) {
  const ordered = [...runs].sort((a, b) =>
    (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt),
  )
  const attention = ordered.filter(
    (run) =>
      (run.status === 'completed' && openWorkForRun(run) > 0) ||
      run.status === 'failed',
  )
  const running = ordered.filter(
    (run) => run.status === 'queued' || run.status === 'running',
  )
  const checked = ordered.filter(
    (run) => run.status === 'completed' && openWorkForRun(run) === 0,
  )
  return [
    { id: 'attention', title: 'Needs attention', runs: attention },
    { id: 'running', title: 'Running', runs: running },
    { id: 'checked', title: 'Checked', runs: checked },
  ].filter((group) => group.runs.length > 0)
}

export function VerifyContents() {
  const runs = useOrganisationVerificationRuns(true)
  const matters = useMattersList().data ?? []
  const matterNames = new Map(matters.map((matter) => [matter.id, matter.name]))

  if (runs.isPending) return <Skeleton className="mx-2 my-2 h-16" />
  if (runs.isError)
    return <Note>Verify runs could not be loaded. Try again.</Note>
  if (runs.runs.length === 0) return <Note>No Verify runs yet.</Note>

  return (
    <div className="flex flex-col">
      {verifyGroups(latestRunsPerDocument(runs.runs)).map((group) => (
        <Group key={group.id} title={group.title} count={group.runs.length}>
          {group.runs.slice(0, ROWS_PER_GROUP).map((run) => (
            <RowLink
              key={run.id}
              to="/verify"
              label={matterNames.get(run.matterId) ?? 'Matter'}
              meta={verificationTag(run)}
              tone={verificationTone(run)}
            />
          ))}
          {group.runs.length > ROWS_PER_GROUP ? (
            <Note>{group.runs.length - ROWS_PER_GROUP} more</Note>
          ) : null}
        </Group>
      ))}
    </div>
  )
}

const REDACT_GROUPS: Array<{
  id: string
  title: string
  statuses: readonly RedactionRunStatus[]
}> = [
  {
    id: 'attention',
    title: 'Needs a decision',
    statuses: ['ready_for_review', 'reviewing'],
  },
  { id: 'failed', title: 'Failed', statuses: ['failed'] },
  { id: 'running', title: 'In progress', statuses: ['pending', 'detecting'] },
  { id: 'done', title: 'Finalised', statuses: ['finalized'] },
]

export function RedactContents() {
  const runs = useRedactionRunsList()
  const list = [...(runs.data?.runs ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )

  if (runs.isPending) return <Skeleton className="mx-2 my-2 h-16" />
  if (runs.isError)
    return <Note>Redaction runs could not be loaded. Try again.</Note>
  if (list.length === 0) return <Note>No redaction runs yet.</Note>

  return (
    <div className="flex flex-col">
      {REDACT_GROUPS.map((group) => {
        const grouped = list.filter((run) =>
          group.statuses.includes(run.status),
        )
        if (grouped.length === 0) return null
        return (
          <Group key={group.id} title={group.title} count={grouped.length}>
            {grouped.slice(0, ROWS_PER_GROUP).map((run) => (
              <RowLink
                key={run.id}
                to="/redact/$runId"
                params={{ runId: run.id }}
                label={run.sourceFilename}
                meta={run.matterName ?? undefined}
              />
            ))}
            {grouped.length > ROWS_PER_GROUP ? (
              <Note>{grouped.length - ROWS_PER_GROUP} more</Note>
            ) : null}
          </Group>
        )
      })}
    </div>
  )
}

export function SearchContents() {
  const recent =
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage)
  if (recent.length === 0) return <Note>No recent searches.</Note>
  return (
    <div className="flex flex-col">
      <Group title="Recent searches">
        {recent.map((search) => (
          <Link
            key={search}
            to="/search"
            search={{ q: search }}
            className={rowClass(false)}
          >
            <span className="min-w-0 flex-1 truncate">{search}</span>
          </Link>
        ))}
      </Group>
    </div>
  )
}

export function SettingsContents() {
  const { data: me } = useCurrentUser()
  const settingsSection = useSettingsSection(me)
  const sections = SETTINGS_SECTIONS.filter((item) => item.available(me))
  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-col gap-px px-1.5 pt-1"
    >
      {sections.map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          to="/settings"
          search={{ section: id }}
          aria-current={id === settingsSection ? 'page' : undefined}
          className={cn(rowClass(id === settingsSection), 'gap-2.5')}
        >
          <Icon size={16} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {id === settingsSection ? (
            <CaretRight size={12} aria-hidden className="text-subtle" />
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
