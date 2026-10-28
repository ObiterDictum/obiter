import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowLeft,
  CircleNotch,
  ShieldCheck,
  Warning,
} from '@phosphor-icons/react'
import type { SpanDecision } from '@obiter/contracts'
import type { RedactionSpan } from '@obiter/redaction-policy'
import {
  Badge,
  Button,
  EmptyState,
  ProgressBar,
  Skeleton,
  StatusDot,
} from '@obiter/ui'
import { PageScaffold, useCurrentUser } from '@obiter/app-shell'
import {
  useRedactionDocumentText,
  useRedactionOutput,
  useRedactionRun,
  useSpanDecision,
} from './hooks'
import { useRedactionSource } from './source-preview-hooks'
import { PdfReviewDocument } from './pdf-review-document'
import { DetectionRetryWarning } from './detection-retry-warning'
import { FinalizeDialog } from './finalize-dialog'
import { FinalizedOutput } from './finalized-output'
import { DecisionBar } from './decision-bar'
import { ReviewPanel, type SpanFilter } from './review-panel'
import {
  DETECTION_COVERAGE_CAVEAT,
  categoryLabel,
  confidenceLabel,
  decisionCounts,
  decisionMarkClass,
  sourceLabel,
  spanDecisionState,
} from './span-copy'
import type { RedactionRun } from './types'

const categoryClasses = {
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
} satisfies Record<RedactionSpan['category'], string>

const sourceClasses = {
  rampart_model: 'border-solid',
  rampart_deterministic: 'border-dotted',
  uk_supplement: 'border-dashed',
} satisfies Record<RedactionSpan['source'], string>

/**
 * The source text as the reviewer reads it. A span is painted by category (the
 * contract's palette) and its decision state is never carried by colour alone:
 * an accepted span keeps its fill, a kept span fades and keeps a dashed
 * baseline, and an undecided span carries a warning outline. The decision is
 * also stated in words in the panel and in the decision bar.
 */
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
      className="max-w-[68ch] text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
      aria-label="Original document text"
    >
      {spans.map((span) => {
        if (span.start < position || span.end > text.length) return null
        const before = text.slice(position, span.start)
        position = span.end
        const state = spanDecisionState(run.decisions[span.id]?.decision)
        return (
          <span key={span.id}>
            {before}
            <button
              type="button"
              data-span-id={span.id}
              onClick={() => onSelect(span.id)}
              className={[
                'inline rounded-sm border-b-2 px-0.5 text-left align-baseline',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                categoryClasses[span.category],
                sourceClasses[span.source],
                decisionMarkClass[state],
                selectedId === span.id ? 'ring-2 ring-ring' : '',
              ].join(' ')}
              aria-pressed={selectedId === span.id}
              title={`${categoryLabel[span.category]} — ${sourceLabel[span.source]} — detection confidence ${confidenceLabel[span.confidence].toLowerCase()}`}
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

function zeroSpanBody(run: RedactionRun) {
  if (run.detectionMode === 'heuristics+supplement')
    return 'The deterministic detectors did not find matching patterns. Model detection did not run, so check the document yourself for names, addresses and dates of birth before finalising.'
  if (run.detectionMode === 'unknown')
    return 'No matching patterns were recorded, and the detection mode is unknown. Check the document yourself for names, addresses and dates of birth before relying on this run.'
  return 'Rampart and the UK supplement did not find matching patterns. Detection finds candidates, not everything sensitive, so check the document yourself before finalising.'
}

/**
 * The page is paper in both themes, so the span palette is pinned to the light
 * token set for this subtree: a dark-theme span tint would paint a dark block on
 * white paper and read as a redaction that is not there.
 */
function Paper({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-12 py-8 max-compact:px-8">
      <div
        data-theme="light"
        className="w-full max-w-[860px] rounded-lg bg-paper px-10 py-10 text-body text-paper-ink shadow-md"
      >
        {children}
      </div>
    </div>
  )
}

export function RedactionReviewView({
  runId,
  onOpenRun,
  onOpenDocument,
  onBack,
}: {
  runId: string
  onOpenRun: (runId: string) => void
  /** Opens a source document's own page after a return-to-document; absent
   * where the host has no route for it. */
  onOpenDocument?: (run: RedactionRun) => void
  /** Returns to the Redact run list; absent where the host has no route. */
  onBack?: () => void
}) {
  const { data: me } = useCurrentUser()
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
  const [filter, setFilter] = useState<SpanFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const listRef = useRef<HTMLDivElement | null>(null)
  const decision = useSpanDecision(runId)

  // Keep the document mark for the selected span in view when choosing from the
  // list, and the list row in view when walking with the decision bar.
  useEffect(() => {
    if (!selectedId) return
    document
      .querySelector<HTMLElement>(`[data-span-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  if (runQuery.isPending || textQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1216px] px-12 py-14 max-compact:px-8">
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    )
  }
  // Prefer cached data over a background refetch error (e.g. finalise
  // invalidateQueries failing) so a successful local write is not blanked out.
  if (!runQuery.data || !textQuery.data) {
    return (
      <PageScaffold title="Redaction review">
        <EmptyState
          title="This redaction run could not be loaded"
          body={
            (runQuery.error ?? textQuery.error)?.message ??
            'Check that you still have access to the matter, then try again.'
          }
          action={
            <Button variant="secondary" onClick={() => void runQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </PageScaffold>
    )
  }

  const run = runQuery.data
  const currentUserId = me?.user.id

  if (run.status === 'finalized')
    return (
      <FinalizedOutput
        run={run}
        outputQuery={outputQuery}
        onOpenDocument={onOpenDocument}
      />
    )

  if (run.status === 'detecting' || run.status === 'pending') {
    return (
      <PageScaffold title={run.sourceFilename} eyebrow="Redaction review">
        <EmptyState
          title="Detection in progress"
          body="Rampart is reading the document. This screen updates when detection finishes; you can leave the page and come back."
          icon={
            <CircleNotch
              className="animate-spin"
              size={28}
              aria-hidden="true"
            />
          }
        />
      </PageScaffold>
    )
  }

  if (run.status === 'failed') {
    return (
      <PageScaffold title={run.sourceFilename} eyebrow="Redaction review">
        <EmptyState
          title="Detection failed"
          body={
            run.summary.failureReason ??
            'The detector stopped before it finished, so this run found nothing. Start a new run before you rely on this document.'
          }
          icon={<Warning size={28} aria-hidden="true" />}
        />
      </PageScaffold>
    )
  }

  const counts = decisionCounts(run.spans, run.decisions)
  // A filter change drops the selection: the decision bar must always describe
  // a span the reviewer can see, not one that the filter just hid.
  const changeFilter = (apply: () => void) => {
    apply()
    setSelectedId(null)
  }
  const filtered = run.spans.filter(
    (span) =>
      (filter === 'all' ||
        spanDecisionState(run.decisions[span.id]?.decision) === filter) &&
      (categoryFilter === 'all' || span.category === categoryFilter) &&
      (sourceFilter === 'all' || span.source === sourceFilter),
  )
  const selected =
    run.spans.find((span) => span.id === selectedId) ?? filtered[0]
  const position = selected
    ? run.spans.findIndex((span) => span.id === selected.id) + 1
    : 0
  const pageCount = layoutQuery.data?.pages.length ?? null
  const pageFor = (span: RedactionSpan): number | null => {
    const layout = layoutQuery.data
    if (!layout) return null
    const segment = layout.segments.find(
      (candidate) =>
        candidate.start <= span.start && candidate.end > span.start,
    )
    return segment ? segment.pageIndex + 1 : null
  }

  const decide = (decisionValue: SpanDecision) => {
    if (!selected || decision.isPending) return
    decision.mutate({ spanId: selected.id, decision: decisionValue })
  }

  const move = (delta: number) => {
    if (!filtered.length || !selected) return
    const index = filtered.findIndex((span) => span.id === selected.id)
    const next =
      filtered[(index + delta + filtered.length) % filtered.length] ?? null
    if (next) setSelectedId(next.id)
  }

  const onListKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!filtered.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (!selected || decision.isPending || run.replacementRunId) return
    // A modified chord belongs to the browser or the app shell, not to a legal
    // decision: Ctrl+K opens app search and Ctrl+R reloads the page. Recording
    // a decision on those chords mutated review state the user did not intend,
    // so a modifier leaves every decision unchanged.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    // A decision shortcut is list-scoped: it belongs to the listbox only while
    // the listbox itself owns focus. A key event that bubbled from a focused
    // row button belongs to that row: acting on the separately selected span
    // would record a legal decision against a span the reviewer was not looking
    // at.
    if (event.target !== event.currentTarget) return
    const key = event.key.toLowerCase()
    const shortcut: SpanDecision | null =
      event.key === 'Enter'
        ? 'accept'
        : key === 'r'
          ? 'reject'
          : key === 'p'
            ? 'pseudonymise'
            : null
    if (!shortcut) return
    event.preventDefault()
    decision.mutate({ spanId: selected.id, decision: shortcut })
  }

  const remaining = counts.pending
  const decidedCount = run.summary.totalSpans - remaining
  const progress =
    run.summary.totalSpans === 0
      ? 100
      : (decidedCount / run.summary.totalSpans) * 100
  const categories = Array.from(new Set(run.spans.map((span) => span.category)))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-12 py-4 max-compact:px-8">
        <div className="flex min-w-0 items-start gap-3">
          {onBack ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to Redact"
              onClick={onBack}
              iconStart={<ArrowLeft size={16} aria-hidden="true" />}
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-section break-words text-ink">
              {run.sourceFilename}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted">
              <span>{run.matterName ?? 'Standalone run'}</span>
              <span aria-hidden="true">·</span>
              <span>Redaction review</span>
              {run.replacementRunId ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Badge tone="neutral">Replaced</Badge>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {run.replacementRunId ? null : (
            <FinalizeDialog
              run={run}
              onShowUndecided={() => {
                setFilter('pending')
                const first = run.spans.find((span) => !run.decisions[span.id])
                if (first) setSelectedId(first.id)
                listRef.current?.focus()
              }}
            />
          )}
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-12 py-3 max-compact:px-8">
        <p className="text-meta text-muted">
          <span className="text-ink">
            {`${String(decidedCount)} of ${String(run.summary.totalSpans)} detected spans decided`}
          </span>
        </p>
        <ProgressBar
          value={progress}
          className="max-w-[200px] min-w-[120px] flex-1"
        />
        <p className="text-caption text-subtle">
          {remaining > 0 ? `${remaining} left · ` : ''}
          {DETECTION_COVERAGE_CAVEAT}
        </p>
        <div className="ml-auto flex items-center gap-4">
          <span className="flex items-center gap-4 text-caption text-muted">
            <StatusDot tone="success">
              {`Redacted ${String(counts.accepted)}`}
            </StatusDot>
            <StatusDot tone="neutral">
              {`Kept visible ${String(counts.rejected)}`}
            </StatusDot>
            <StatusDot tone="warning">
              {`Needs review ${String(counts.pending)}`}
            </StatusDot>
          </span>
          {pageCount === null ? null : (
            <span className="text-caption text-subtle">
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
          )}
        </div>
      </div>

      {run.replacementRunId || run.detectionMode !== 'model+supplement' ? (
        <div className="shrink-0">
          <DetectionRetryWarning run={run} onOpenRun={onOpenRun} />
        </div>
      ) : null}

      {run.spans.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-12 py-8 max-compact:px-8">
          <EmptyState
            title="No sensitive data was detected in this document"
            body={zeroSpanBody(run)}
            icon={<ShieldCheck size={28} aria-hidden="true" />}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
              {pdfPreviewEnabled && sourceFileQuery.data && layoutQuery.data ? (
                <PdfReviewDocument
                  file={sourceFileQuery.data}
                  layout={layoutQuery.data}
                  spans={run.spans}
                  decisions={run.decisions}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                  categoryClassName={categoryClasses}
                />
              ) : (
                <Paper>
                  <HighlightedText
                    text={textQuery.data.text}
                    run={run}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelectedId}
                  />
                </Paper>
              )}
            </div>
            {run.replacementRunId ? (
              <p className="border-t border-line bg-surface px-12 py-3 text-meta text-muted max-compact:px-8">
                A newer model-detected run is available, so this run can no
                longer take decisions or be finalised. Open the replacement run
                above to continue.
              </p>
            ) : (
              <DecisionBar
                span={selected}
                position={position}
                total={run.spans.length}
                decisions={run.decisions}
                currentUserId={currentUserId}
                page={selected ? pageFor(selected) : null}
                pageCount={pageCount}
                pending={decision.isPending}
                error={
                  decision.error
                    ? `The decision was not saved. ${decision.error.message}`
                    : null
                }
                canPrevious={filtered.length > 1}
                canNext={filtered.length > 1}
                onPrevious={() => move(-1)}
                onNext={() => move(1)}
                onDecide={decide}
              />
            )}
          </div>
          <ReviewPanel
            spans={filtered}
            decisions={run.decisions}
            counts={counts}
            currentUserId={currentUserId}
            bySource={run.summary.bySource}
            filter={filter}
            onFilterChange={(next) => changeFilter(() => setFilter(next))}
            category={categoryFilter}
            onCategoryChange={(next) =>
              changeFilter(() => setCategoryFilter(next))
            }
            source={sourceFilter}
            onSourceChange={(next) => changeFilter(() => setSourceFilter(next))}
            categories={categories}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onKeyDown={onListKeys}
            listRef={listRef}
            pageFor={pageFor}
            pageCount={pageCount}
          />
        </div>
      )}
    </div>
  )
}
