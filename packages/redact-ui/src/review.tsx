import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  Check,
  CircleNotch,
  EyeSlash,
  Funnel,
  ShieldCheck,
  Warning,
} from '@phosphor-icons/react'
import type { SpanCategory, SpanDecision, SpanSource } from '@obiter/contracts'
import {
  Badge,
  Button,
  EmptyState,
  ProgressBar,
  Select,
  Skeleton,
  cn,
} from '@obiter/ui'
import {
  useRedactionDocumentText,
  useRedactionOutput,
  useRedactionOutputFile,
  useRedactionRun,
  useSpanDecision,
} from './hooks'
import { useRedactionSource } from './source-preview-hooks'
import { PdfDocumentPreview } from './pdf-document-preview'
import { PdfReviewDocument } from './pdf-review-document'
import { DetectionRetryWarning } from './detection-retry-warning'
import { FinalizeDialog } from './finalize-dialog'
import type { RedactionRun } from './types'

const categoryClasses: Record<SpanCategory, string> = {
  person_name: 'bg-span-person-name text-span-person-name-fg',
  email: 'bg-span-email text-span-email-fg',
  phone: 'bg-span-phone text-span-phone-fg',
  address: 'bg-span-address text-span-address-fg',
  date: 'bg-span-date text-span-date-fg',
  government_id: 'bg-span-government-id text-span-government-id-fg',
  account_number: 'bg-span-account-number text-span-account-number-fg',
  passport: 'bg-span-passport text-span-passport-fg',
  drivers_license: 'bg-span-drivers-license text-span-drivers-license-fg',
  url: 'bg-span-url text-span-url-fg',
  ip_address: 'bg-span-ip-address text-span-ip-address-fg',
  national_insurance:
    'bg-span-national-insurance text-span-national-insurance-fg',
  case_reference: 'bg-span-case-reference text-span-case-reference-fg',
  organisation_name: 'bg-span-organisation-name text-span-organisation-name-fg',
  secret: 'bg-span-secret text-span-secret-fg',
}
const sourceClasses: Record<SpanSource, string> = {
  rampart_model: 'border-solid',
  rampart_deterministic: 'border-dotted',
  uk_supplement: 'border-dashed',
}
const sourceLabel: Record<SpanSource, string> = {
  rampart_model: 'Rampart model',
  rampart_deterministic: 'Rampart deterministic',
  uk_supplement: 'UK supplement',
}
const decisions: Array<{
  value: SpanDecision
  label: string
  shortcut: string
}> = [
  { value: 'accept', label: 'Accept', shortcut: 'Enter' },
  { value: 'reject', label: 'Reject', shortcut: 'R' },
  { value: 'override_redact', label: 'Override redact', shortcut: 'Ctrl+R' },
  { value: 'override_keep', label: 'Override keep', shortcut: 'Ctrl+K' },
  { value: 'pseudonymise', label: 'Pseudonymise', shortcut: 'P' },
]

function ReviewDeskShell({
  title,
  meta,
  actions,
  children,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {meta ? <p className="mt-0.5 text-xs text-muted">{meta}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function ReviewSummary({ run }: { run: RedactionRun }) {
  const total = run.summary.totalSpans
  const progress = total === 0 ? 100 : (run.summary.reviewedCount / total) * 100
  return (
    <section
      className="flex flex-col gap-2 border-b border-line px-5 py-3 sm:px-6"
      aria-label="Review summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Review progress</h2>
          <p className="text-xs text-muted">
            {total} spans · {run.summary.reviewedCount} reviewed ·{' '}
            {run.summary.unreviewedCount} unreviewed
          </p>
        </div>
        {run.summary.reviewedCount === total ? (
          <Badge tone="success">
            <Check size={14} aria-hidden="true" /> All spans reviewed
          </Badge>
        ) : null}
      </div>
      <ProgressBar
        value={progress}
        label="Reviewed spans"
        helperText={`${Math.round(progress)}% complete`}
      />
      <p className="text-[11px] text-subtle">
        {run.summary.bySource.rampartModel} Rampart model ·{' '}
        {run.summary.bySource.rampartDeterministic} deterministic ·{' '}
        {run.summary.bySource.ukSupplement} UK supplement
      </p>
    </section>
  )
}

function HighlightedText({
  text,
  run,
  selectedId,
  onSelect,
}: {
  text: string
  run: RedactionRun
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const spans = [...run.spans].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )
  let position = 0
  return (
    <article
      className="whitespace-pre-wrap text-base leading-relaxed text-ink [overflow-wrap:anywhere]"
      aria-label="Original document text"
    >
      {spans.map((span) => {
        if (span.start < position || span.end > text.length) return null
        const before = text.slice(position, span.start)
        position = span.end
        return (
          <span key={span.id}>
            {before}
            <button
              type="button"
              data-span-id={span.id}
              onClick={() => onSelect(span.id)}
              className={cn(
                'inline rounded-sm border-b-2 px-0.5 text-left align-baseline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                categoryClasses[span.category],
                sourceClasses[span.source],
                selectedId === span.id && 'ring-2 ring-ring',
              )}
              aria-pressed={selectedId === span.id}
              title={`${span.category.replaceAll('_', ' ')} — ${sourceLabel[span.source]}`}
            >
              {span.text}
            </button>
          </span>
        )
      })}
      {text.slice(position)}
    </article>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Defer revoke past the click handler so the browser can start the download.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, {
    type: blob.type || 'application/octet-stream',
  })
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return
    }
  } catch {
    // User cancelled share or share failed — fall through to download.
  }
  downloadBlob(blob, filename)
}

const downgradeCopy: Record<string, string> = {
  tracked_change:
    'Part of this document holds redacted text inside a tracked change, which redaction does not cover. Accept or reject the tracked changes and finalize again. Do not serve this file without checking it first.',
  residual_text:
    'Some redacted text could not be removed from the document safely. Do not serve this file without checking it first.',
  burn_failed:
    'The formatted document could not be produced, so a plain-text file was provided instead. Do not serve this file without checking it first.',
}

function OutputDowngradeWarning({ run }: { run: RedactionRun }) {
  const downgrade = run.summary.outputDowngrade
  if (!downgrade) return null
  const title =
    downgrade.from === 'docx'
      ? 'Word document unavailable — text file provided instead'
      : 'PDF unavailable — text file provided instead'
  return (
    <section
      className="flex flex-wrap items-start gap-3 border-b border-warning/40 bg-raised/40 px-5 py-3 text-sm text-ink sm:px-6"
      role="alert"
    >
      <Warning
        className="mt-0.5 shrink-0 text-warning"
        size={18}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-muted">
          {downgradeCopy[downgrade.reason] ?? downgradeCopy.burn_failed}
        </p>
      </div>
    </section>
  )
}

function FinalizedOutput({
  run,
  outputQuery,
}: {
  run: RedactionRun
  outputQuery: ReturnType<typeof useRedactionOutput>
}) {
  const mimeType =
    outputQuery.data?.mimeType ?? run.summary.outputMimeType ?? 'text/plain'
  const isPdf = mimeType === 'application/pdf'
  const isDocx =
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  // Both burned outputs download as files; only the PDF previews inline.
  const isFile = isPdf || isDocx
  const filename =
    outputQuery.data?.filename ??
    run.summary.outputFilename ??
    run.sourceFilename
  const fileQuery = useRedactionOutputFile(
    run.id,
    isFile && Boolean(run.outputArtifactId),
  )

  return (
    <section className="px-4 py-4 sm:px-5" aria-label="Redaction output">
      <div className="w-full rounded-lg border border-line-strong bg-raised text-ink shadow-lg">
        <OutputDowngradeWarning run={run} />
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-8 py-6 md:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Finalized output
            </p>
            <h2 className="mt-2 text-lg font-semibold leading-snug text-ink">
              {filename}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {isPdf
                ? 'Redacted PDF ready to download or share.'
                : isDocx
                  ? 'Redacted document ready to download or share.'
                  : 'Redacted text ready to download or share.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={
                isFile
                  ? !fileQuery.data
                  : !outputQuery.data?.text && outputQuery.data?.text !== ''
              }
              onClick={() => {
                if (isFile && fileQuery.data) {
                  downloadBlob(fileQuery.data, filename)
                  return
                }
                if (outputQuery.data?.text != null) {
                  downloadBlob(
                    new Blob([outputQuery.data.text], {
                      type: 'text/plain;charset=utf-8',
                    }),
                    filename,
                  )
                }
              }}
            >
              Download
            </Button>
            <Button
              disabled={
                isFile
                  ? !fileQuery.data
                  : !outputQuery.data?.text && outputQuery.data?.text !== ''
              }
              onClick={() => {
                void (async () => {
                  if (isFile && fileQuery.data) {
                    await shareOrDownload(fileQuery.data, filename)
                    return
                  }
                  if (outputQuery.data?.text != null) {
                    await shareOrDownload(
                      new Blob([outputQuery.data.text], {
                        type: 'text/plain;charset=utf-8',
                      }),
                      filename,
                    )
                  }
                })()
              }}
            >
              Share
            </Button>
          </div>
        </header>
        <div className="px-4 py-4 sm:px-5 md:px-6">
          {outputQuery.isPending || (isFile && fileQuery.isPending) ? (
            <Skeleton className="h-32" />
          ) : outputQuery.error ? (
            <p className="text-sm text-danger">{outputQuery.error.message}</p>
          ) : isFile && fileQuery.error ? (
            <p className="text-sm text-danger">{fileQuery.error.message}</p>
          ) : isPdf && fileQuery.data ? (
            <PdfDocumentPreview file={fileQuery.data} />
          ) : isDocx && fileQuery.data ? (
            <p className="text-sm text-muted">
              The redacted document keeps its formatting. Use Download to open
              it in Word.
            </p>
          ) : (
            <div className="px-4 pb-4 text-base leading-relaxed text-ink [overflow-wrap:anywhere] whitespace-pre-wrap md:px-5">
              {outputQuery.data?.text}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function reviewEyebrow(run: RedactionRun) {
  return run.matterId
    ? `Matter ${run.matterName ?? run.matterId} · ${run.sourceFilename}`
    : `Standalone · ${run.sourceFilename}`
}

function zeroSpanBody(run: RedactionRun) {
  if (run.detectionMode === 'heuristics+supplement')
    return 'The deterministic detectors did not find matching patterns. Model detection did not run, so manually check for names, addresses and dates of birth before finalising.'
  if (run.detectionMode === 'unknown')
    return 'No matching patterns were recorded, and the detection mode is unknown. Manually check for names, addresses and dates of birth before relying on this run.'
  return 'Rampart and the UK supplement did not find matching patterns. You can still finalize this run without changes.'
}

export function RedactionReviewView({
  runId,
  onOpenRun,
}: {
  runId: string
  onOpenRun: (runId: string) => void
}) {
  const runQuery = useRedactionRun(runId)
  const textQuery = useRedactionDocumentText(runId)
  const pdfPreviewEnabled = runQuery.data?.sourcePreview?.available === true
  const sourceFileQuery = useRedactionSource(
    runId,
    'source-file',
    pdfPreviewEnabled,
  )
  const layoutQuery = useRedactionSource(runId, 'layout', pdfPreviewEnabled)
  const outputQuery = useRedactionOutput(
    runId,
    runQuery.data?.status === 'finalized',
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const decision = useSpanDecision(runId)

  // Keep the document mark for the selected span in view when choosing from the list.
  useEffect(() => {
    if (!selectedId) return
    const mark = document.querySelector<HTMLElement>(
      `[data-span-id="${CSS.escape(selectedId)}"]`,
    )
    mark?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  if (runQuery.isPending || textQuery.isPending) {
    return (
      <ReviewDeskShell title="Loading review" meta="Redact">
        <div className="flex flex-col gap-3 overflow-y-auto p-5">
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </div>
      </ReviewDeskShell>
    )
  }
  // Prefer cached data over a background refetch error (e.g. finalize
  // invalidateQueries failing) so a successful local write is not blanked out.
  if (!runQuery.data || !textQuery.data) {
    return (
      <ReviewDeskShell title="Review unavailable" meta="Redact">
        <div className="overflow-y-auto p-6">
          <EmptyState
            title="Could not load this redaction run"
            body={(runQuery.error ?? textQuery.error)?.message}
            icon={<EyeSlash size={28} aria-hidden="true" />}
          />
        </div>
      </ReviewDeskShell>
    )
  }

  const run = runQuery.data
  const eyebrow = reviewEyebrow(run)

  if (run.status === 'detecting' || run.status === 'pending') {
    return (
      <ReviewDeskShell title="Detection in progress" meta="Redact">
        <div className="overflow-y-auto p-6">
          <EmptyState
            title="Rampart is scanning the document"
            body="This may take a moment for a large document. This screen will update when detection is complete."
            icon={
              <CircleNotch
                className="animate-spin"
                size={28}
                aria-hidden="true"
              />
            }
          />
        </div>
      </ReviewDeskShell>
    )
  }

  // Zero-span runs: still show finalize / finalized output (do not trap in the
  // empty EmptyState after a successful finalize).
  if (run.spans.length === 0) {
    return (
      <ReviewDeskShell
        title={
          run.status === 'finalized'
            ? 'Redaction review'
            : 'No sensitive data detected'
        }
        meta={eyebrow}
        actions={
          run.status === 'finalized' ? (
            <Badge tone="success">Finalized</Badge>
          ) : run.replacementRunId ? (
            <Badge tone="neutral">Replaced</Badge>
          ) : (
            <FinalizeDialog run={run} />
          )
        }
      >
        <div className="flex flex-col gap-4 overflow-y-auto p-5 sm:p-6">
          <DetectionRetryWarning run={run} onOpenRun={onOpenRun} />
          {run.status === 'finalized' ? (
            <FinalizedOutput run={run} outputQuery={outputQuery} />
          ) : (
            <EmptyState
              title="No sensitive data was detected in this document"
              body={zeroSpanBody(run)}
              icon={<ShieldCheck size={28} aria-hidden="true" />}
            />
          )}
        </div>
      </ReviewDeskShell>
    )
  }

  const filtered = run.spans.filter(
    (span) =>
      (categoryFilter === 'all' || span.category === categoryFilter) &&
      (sourceFilter === 'all' || span.source === sourceFilter),
  )
  const selected =
    run.spans.find((span) => span.id === selectedId) ?? filtered[0]

  const onListKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!filtered.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = selected
        ? filtered.findIndex((span) => span.id === selected.id)
        : 0
      setSelectedId(
        filtered[
          (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
            filtered.length
        ]?.id ?? null,
      )
      return
    }
    if (!selected || run.status === 'finalized' || run.replacementRunId) return
    const key = event.key.toLowerCase()
    const shortcutDecision = event.ctrlKey
      ? key === 'r'
        ? 'override_redact'
        : key === 'k'
          ? 'override_keep'
          : null
      : event.key === 'Enter'
        ? 'accept'
        : key === 'r'
          ? 'reject'
          : key === 'p'
            ? 'pseudonymise'
            : null
    if (!shortcutDecision) return
    event.preventDefault()
    decision.mutate({ spanId: selected.id, decision: shortcutDecision })
  }

  const pending = run.summary.unreviewedCount

  return (
    <ReviewDeskShell
      title="Redaction review"
      meta={eyebrow}
      actions={
        run.status === 'finalized' ? (
          <Badge tone="success">Finalized</Badge>
        ) : run.replacementRunId ? (
          <Badge tone="neutral">Replaced</Badge>
        ) : (
          <FinalizeDialog run={run} />
        )
      }
    >
      <div className="shrink-0">
        <DetectionRetryWarning run={run} onOpenRun={onOpenRun} />
      </div>
      <div className="shrink-0">
        <ReviewSummary run={run} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <section
          className="min-h-0 overflow-y-auto border-b border-line xl:border-b-0 xl:border-r"
          aria-label="Document"
        >
          {run.status === 'finalized' ? (
            <FinalizedOutput run={run} outputQuery={outputQuery} />
          ) : pdfPreviewEnabled && sourceFileQuery.data && layoutQuery.data ? (
            <PdfReviewDocument
              file={sourceFileQuery.data}
              layout={layoutQuery.data}
              spans={run.spans}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              categoryClassName={categoryClasses}
            />
          ) : (
            <div className="px-4 py-4 sm:px-5">
              <div className="w-full rounded-lg border border-line-strong bg-raised p-8 text-ink shadow-lg md:p-10">
                <header className="mb-6 border-b border-line pb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                    Source document
                  </p>
                  <h2 className="mt-2 text-lg font-semibold leading-snug text-ink">
                    {run.sourceFilename}
                  </h2>
                </header>
                <HighlightedText
                  text={textQuery.data.text}
                  run={run}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
          )}
        </section>
        <aside
          className="flex min-h-0 flex-col xl:max-h-none"
          aria-label="Review queue"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-muted">
                Review queue
              </p>
              <h2 className="text-sm font-semibold text-ink">Detected spans</h2>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <Funnel size={14} aria-hidden="true" />
              {run.summary.totalSpans} spans
              {pending > 0 ? ` · ${pending} pending` : ' · queue clear'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3">
            <Select
              value={categoryFilter}
              onValueChange={(value) => setCategoryFilter(value ?? 'all')}
              options={[
                { value: 'all', label: 'All categories' },
                ...Array.from(
                  new Set(run.spans.map((span) => span.category)),
                ).map((value) => ({
                  value,
                  label: value.replaceAll('_', ' '),
                })),
              ]}
            />
            <Select
              value={sourceFilter}
              onValueChange={(value) => setSourceFilter(value ?? 'all')}
              options={[
                { value: 'all', label: 'All sources' },
                ...Object.entries(sourceLabel).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            role="listbox"
            tabIndex={0}
            onKeyDown={onListKeys}
          >
            {filtered.map((span) => (
              <button
                type="button"
                key={span.id}
                onClick={() => setSelectedId(span.id)}
                className={cn(
                  'flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-left text-sm transition-colors hover:bg-raised',
                  selected?.id === span.id && 'bg-raised',
                )}
                role="option"
                aria-selected={selected?.id === span.id}
              >
                <span className="truncate font-mono text-ink">{span.text}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge tone="neutral">
                    {span.category.replaceAll('_', ' ')}
                  </Badge>
                  <Badge tone="info">{span.confidence}</Badge>
                  {run.decisions[span.id] ? (
                    <Badge tone="success">
                      {run.decisions[span.id].decision.replaceAll('_', ' ')}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Unreviewed</Badge>
                  )}
                </span>
              </button>
            ))}
          </div>
          {selected && run.status !== 'finalized' && !run.replacementRunId ? (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-xs text-muted">
                Decision for{' '}
                <span className="font-mono text-ink">{selected.text}</span>
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {decisions.map((action) => (
                  <Button
                    key={action.value}
                    size="sm"
                    variant={
                      action.value === 'override_redact'
                        ? 'danger'
                        : 'secondary'
                    }
                    loading={
                      decision.isPending &&
                      decision.variables?.spanId === selected.id
                    }
                    onClick={() =>
                      decision.mutate({
                        spanId: selected.id,
                        decision: action.value,
                      })
                    }
                  >
                    {action.label}{' '}
                    <span className="ml-auto text-subtle">
                      {action.shortcut}
                    </span>
                  </Button>
                ))}
              </div>
              {decision.error ? (
                <p className="mt-2 text-sm text-danger">
                  {decision.error.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </ReviewDeskShell>
  )
}
