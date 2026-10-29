import { Link } from '@tanstack/react-router'
import { CaretRight, FileText } from '@phosphor-icons/react'
import {
  Card,
  EmptyState,
  Skeleton,
  StatusDot,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  cn,
} from '@obiter/ui'
import type { StatusDotProps } from '@obiter/ui'
import type { MatterDocumentRecord } from '../documents'
import { formatDate } from '../format'
import { RedactedMark } from '../redacted-mark'
import {
  attentionRunLabel,
  useRedactionRunsList,
  type RedactionRunListItem,
} from '../redaction-runs'
import {
  useLatestVerificationRuns,
  type DocumentVerificationState,
} from '../verification-runs'
import { MatterUploadButton, NewDocumentButton } from './matter-upload'

export interface VerifyPart {
  label: string
  tone: NonNullable<StatusDotProps['tone']>
}

/**
 * A document's Verify state as quiet status words. The same words appear in the
 * matter's document table and in the list's preview, so a document never reads
 * differently in the two places. A run on an earlier version says so: it says
 * nothing about the text on screen.
 */
function documentVerifyParts(state: DocumentVerificationState): VerifyPart[] {
  if (state.status === 'pending')
    return [{ label: 'Checking…', tone: 'neutral' }]
  if (state.status === 'unavailable') {
    return [{ label: 'Verify unavailable', tone: 'warning' }]
  }
  const run = state.run
  if (!run) return [{ label: 'Not run', tone: 'neutral' }]
  const stale: VerifyPart[] = run.stale
    ? [{ label: 'Earlier version', tone: 'neutral' }]
    : []
  switch (run.status) {
    case 'queued':
    case 'running':
      return [{ label: 'In progress', tone: 'info' }, ...stale]
    case 'failed':
      return [{ label: 'Failed', tone: 'danger' }, ...stale]
    case 'completed': {
      const parts: VerifyPart[] = []
      const { flaggedCount } = run.summary
      // A check that did not run is still waiting on a person, so the table
      // folds it into review the way the attention queue does.
      const reviewRequiredCount =
        run.summary.reviewRequiredCount + run.summary.notCheckedCount
      if (flaggedCount > 0) {
        parts.push({
          label: `${flaggedCount} flagged`,
          tone: 'danger',
        })
      }
      if (reviewRequiredCount > 0) {
        parts.push({
          label: `${reviewRequiredCount} need review`,
          tone: 'warning',
        })
      }
      if (parts.length === 0)
        parts.push({ label: 'No findings', tone: 'success' })
      return [...parts, ...stale]
    }
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}

/**
 * A document's Redact state: the newest run on it, in the same words Redact uses
 * for a run's own status. A run started from Redact as a standalone job is not
 * attached to a document, so it never appears here.
 */
function documentRedactPart(run: RedactionRunListItem): VerifyPart {
  switch (run.status) {
    case 'failed':
      return { label: attentionRunLabel(run.status), tone: 'danger' }
    case 'finalized':
      return { label: attentionRunLabel(run.status), tone: 'success' }
    case 'pending':
      return { label: attentionRunLabel(run.status), tone: 'neutral' }
    case 'detecting':
    case 'ready_for_review':
    case 'reviewing':
      return { label: attentionRunLabel(run.status), tone: 'info' }
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}

/** The newest run per document, from the run list the shell already reads. */
function latestRunsByDocument(
  runs: RedactionRunListItem[],
): Map<string, RedactionRunListItem> {
  const latest = new Map<string, RedactionRunListItem>()
  for (const run of runs) {
    if (!run.documentId) continue
    const current = latest.get(run.documentId)
    if (!current || run.createdAt > current.createdAt) {
      latest.set(run.documentId, run)
    }
  }
  return latest
}

/** The document glyph, the same in the table and in the list's preview. */
export function DocumentIcon() {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-sm bg-fill text-subtle"
    >
      <FileText size={14} />
    </span>
  )
}

/** A document's Verify state as status words, for a table cell or a preview row. */
function VerifyWords({
  parts,
  className,
}: {
  parts: VerifyPart[]
  className?: string
}) {
  return (
    <span className={cn('flex flex-wrap items-center gap-3', className)}>
      {parts.map((part) => (
        <StatusDot key={part.label} tone={part.tone}>
          {part.label}
        </StatusDot>
      ))}
    </span>
  )
}

/**
 * The matter's documents: one row each, the current version, its Verify state
 * and an open action. Row heights are the primitive's 52px minimum and the
 * action sits in a table cell of its own, so the dividers run the full row.
 */
export function MatterDocumentsTable({
  matterId,
  documents,
  loading,
  error,
}: {
  matterId: string
  documents: MatterDocumentRecord[] | undefined
  loading: boolean
  error: string | null
}) {
  const files = documents ?? []
  const verify = useLatestVerificationRuns(files.map((file) => file.id))
  const redaction = latestRunsByDocument(
    useRedactionRunsList().data?.runs ?? [],
  )

  // Nothing to tabulate yet: an empty table said "No documents yet" in one grey
  // line, which is a dead end in the place a matter starts. The page takes a
  // dropped file too (MatterDropZone).
  if (!loading && !error && files.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={18} aria-hidden />}
        title="No documents yet"
        body="Upload a DOCX, text-layer PDF or TXT file — or drop one anywhere on this page — and it will be checked for citations here."
        action={
          <>
            <MatterUploadButton matterId={matterId} variant="primary" />
            <NewDocumentButton matterId={matterId} />
          </>
        }
      />
    )
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="pl-4">Document</TH>
            <TH className="px-3">Verify</TH>
            <TH className="px-3">Redact</TH>
            <TH className="px-3 text-right">Updated</TH>
            <TH className="pr-4">
              <span className="sr-only">Open</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {loading ? (
            [0, 1, 2].map((index) => (
              <TR key={index} className="hover:bg-transparent">
                <TD className="pl-4">
                  <Skeleton className="h-4 w-56" />
                </TD>
                <TD className="px-3">
                  <Skeleton className="h-3 w-24" />
                </TD>
                <TD className="px-3">
                  <Skeleton className="h-3 w-16" />
                </TD>
                <TD className="px-3 text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </TD>
                <TD />
              </TR>
            ))
          ) : error ? (
            <TR className="hover:bg-transparent">
              <TD colSpan={5} className="pl-4 text-meta text-muted">
                {error}
              </TD>
            </TR>
          ) : (
            files.map((file) => {
              const version = file.currentVersion
              const filename = version?.filename ?? file.logicalKey
              const redactRun = redaction.get(file.id)
              return (
                <TR key={file.id}>
                  <TD className="pl-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <DocumentIcon />
                      <div className="min-w-0">
                        <Link
                          to="/matters/$matterId/documents/$documentId"
                          params={{ matterId, documentId: file.id }}
                          className="block text-item text-ink hover:text-brand"
                        >
                          {filename}
                        </Link>
                        <span className="mt-1 flex items-center gap-2 text-meta text-subtle">
                          <span>
                            {version
                              ? `Version ${version.versionNumber} · ${version.fileType.toUpperCase()}`
                              : 'No version'}
                          </span>
                          {version ? (
                            <RedactedMark
                              redaction={version.redaction}
                              producedAt={version.createdAt}
                            />
                          ) : null}
                        </span>
                      </div>
                    </div>
                  </TD>
                  <TD className="px-3 whitespace-nowrap">
                    <VerifyWords
                      parts={documentVerifyParts(
                        verify.get(file.id) ?? { status: 'pending' },
                      )}
                    />
                  </TD>
                  <TD className="px-3 whitespace-nowrap">
                    <VerifyWords
                      parts={
                        redactRun
                          ? [documentRedactPart(redactRun)]
                          : [{ label: 'Not run', tone: 'neutral' }]
                      }
                    />
                  </TD>
                  <TD className="px-3 text-right text-meta whitespace-nowrap text-subtle tabular-nums">
                    {formatDate(version?.updatedAt ?? file.updatedAt)}
                  </TD>
                  <TD className="pr-4 text-right">
                    <Link
                      to="/matters/$matterId/documents/$documentId"
                      params={{ matterId, documentId: file.id }}
                      aria-label={`Open ${filename}`}
                      className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink"
                    >
                      <CaretRight size={16} aria-hidden />
                    </Link>
                  </TD>
                </TR>
              )
            })
          )}
        </TBody>
      </Table>
    </Card>
  )
}
