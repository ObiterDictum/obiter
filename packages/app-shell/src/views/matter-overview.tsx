import { Link } from '@tanstack/react-router'
import { Badge, type BadgeTone } from '@obiter/ui'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MatterDocumentRecord } from '../documents'
import type { MatterRecord } from '../matters'
import { attentionRunLabel, useRedactionRunsList } from '../redaction-runs'
import { verificationOutcomeTone } from '../verification-copy'
import {
  useLatestVerificationRuns,
  type DocumentVerificationState,
} from '../verification-runs'

type DocumentsQuery = Pick<
  UseQueryResult<MatterDocumentRecord[]>,
  'data' | 'isLoading' | 'isError'
>

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

/** The matter's facts, documents, and redaction runs, from existing reads. */
export function MatterOverview({
  matter,
  documents,
}: {
  matter: MatterRecord
  documents: DocumentsQuery
}) {
  const docs = documents.data ?? []
  const verification = useLatestVerificationRuns(docs.map((doc) => doc.id))
  const runs = useRedactionRunsList()
  const matterRuns =
    runs.data?.runs.filter((run) => run.matterId === matter.id) ?? []
  const facts = [
    ['Client reference', matter.clientReference || 'None recorded'],
    ['Jurisdiction', matter.primaryJurisdiction],
    ['Legal domains', matter.legalDomains.join(', ') || 'None recorded'],
    ['Status', matter.status],
    ['Created', formatDate(matter.createdAt)],
    ['Updated', formatDate(matter.updatedAt)],
  ]

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-5 sm:p-6">
      {matter.description ? (
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          {matter.description}
        </p>
      ) : null}
      <section aria-label="Matter">
        <h2 className={headingClass}>Matter</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] font-medium text-muted">{label}</dt>
              <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Section
        title="Documents"
        query={documents}
        empty="No documents yet. Create or upload one from the list."
      >
        {docs.map((doc) => (
          <li key={doc.id}>
            <Link
              to="/matters/$matterId/documents/$documentId"
              params={{ matterId: matter.id, documentId: doc.id }}
              className={rowClass}
            >
              <RowText
                title={doc.currentVersion?.filename ?? doc.logicalKey}
                detail={
                  doc.currentVersion
                    ? `Version ${doc.currentVersion.versionNumber} · ${formatDate(doc.currentVersion.createdAt)}`
                    : 'No version'
                }
              />
              <VerifyStatus
                state={verification.get(doc.id) ?? { status: 'pending' }}
              />
            </Link>
          </li>
        ))}
      </Section>
      <Section
        title="Redaction runs"
        query={runs}
        empty="No redaction runs for this matter."
      >
        {matterRuns.map((run) => (
          <li key={run.id}>
            <Link
              to="/redact/$runId"
              params={{ runId: run.id }}
              className={rowClass}
            >
              <RowText
                title={run.sourceFilename}
                detail={`Updated ${formatDate(run.updatedAt)}`}
              />
              <Badge tone={run.status === 'failed' ? 'danger' : 'neutral'}>
                {attentionRunLabel(run.status)}
              </Badge>
              <span className="text-[12px] font-medium text-brand">Review</span>
            </Link>
          </li>
        ))}
      </Section>
    </div>
  )
}

const headingClass =
  'mb-2 border-b border-line pb-2 text-[13px] font-semibold text-ink'
const rowClass =
  'flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-raised'

/** A titled list that says what it is loading, or why it is empty. */
function Section({
  title,
  query,
  empty,
  children,
}: {
  title: string
  query: { isLoading: boolean; isError: boolean }
  empty: string
  children: ReactNode[]
}) {
  return (
    <section aria-label={title} className="text-sm text-muted">
      <h2 className={headingClass}>{title}</h2>
      {query.isError ? (
        `${title} could not be loaded.`
      ) : query.isLoading ? (
        `Loading ${title.toLowerCase()}…`
      ) : children.length === 0 ? (
        empty
      ) : (
        <ul>{children}</ul>
      )}
    </section>
  )
}

function RowText({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium text-ink">{title}</span>
      <span className="block truncate text-[11px]">{detail}</span>
    </span>
  )
}

function VerifyStatus({ state }: { state: DocumentVerificationState }) {
  const [label, tone] = verifyStatusCopy(state)
  return <Badge tone={tone}>{label}</Badge>
}

function verifyStatusCopy(
  state: DocumentVerificationState,
): [string, BadgeTone] {
  if (state.status === 'pending') return ['Loading Verify status…', 'neutral']
  if (state.status === 'unavailable') {
    return ['Verify status unavailable', 'warning']
  }
  const run = state.run
  if (!run) return ['Not verified', 'neutral']
  // A run on an earlier version says nothing about the current text.
  const version = run.stale ? ' (earlier version)' : ''
  switch (run.status) {
    case 'queued':
    case 'running':
      return [`Verify in progress${version}`, 'info']
    case 'failed':
      return [`Verify failed${version}`, 'danger']
    case 'completed':
      return [
        `${run.summary.flaggedCount} flagged · ${run.summary.reviewRequiredCount} need review${version}`,
        verificationOutcomeTone(run.summary),
      ]
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}
