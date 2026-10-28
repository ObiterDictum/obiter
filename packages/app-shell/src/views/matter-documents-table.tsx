import { Link } from '@tanstack/react-router'
import { CaretRight, FileText } from '@phosphor-icons/react'
import {
  Card,
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
import {
  useLatestVerificationRuns,
  type DocumentVerificationState,
} from '../verification-runs'

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

  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="pl-4">Document</TH>
            <TH className="px-4">Verify</TH>
            <TH className="px-4 text-right">Updated</TH>
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
                <TD className="px-4">
                  <Skeleton className="h-3 w-24" />
                </TD>
                <TD className="px-4 text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </TD>
                <TD />
              </TR>
            ))
          ) : error ? (
            <TR className="hover:bg-transparent">
              <TD colSpan={4} className="pl-4 text-meta text-muted">
                {error}
              </TD>
            </TR>
          ) : files.length === 0 ? (
            <TR className="hover:bg-transparent">
              <TD colSpan={4} className="pl-4 text-meta text-muted">
                No documents yet. Upload a DOCX, text-layer PDF or TXT file.
              </TD>
            </TR>
          ) : (
            files.map((file) => {
              const version = file.currentVersion
              const filename = version?.filename ?? file.logicalKey
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
                        <span className="mt-1 block text-meta text-subtle">
                          {version
                            ? `Version ${version.versionNumber} · ${version.fileType.toUpperCase()}`
                            : 'No version'}
                        </span>
                      </div>
                    </div>
                  </TD>
                  <TD className="px-4">
                    <VerifyWords
                      parts={documentVerifyParts(
                        verify.get(file.id) ?? { status: 'pending' },
                      )}
                    />
                  </TD>
                  <TD className="px-4 text-right text-meta text-subtle tabular-nums">
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
