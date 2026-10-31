import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Badge,
  Button,
  EmptyState,
  ProgressBar,
  Skeleton,
  StatusDot,
} from '@obiter/ui'
import { ArrowLeft, CircleNotch, ShieldCheck } from '@obiter/ui/icons'
import type { SpanDecision } from '@obiter/contracts'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { sameTextOccurrences } from '@obiter/redaction-policy'
import { PageScaffold, useCurrentUser } from '@obiter/app-shell'
import {
  useCreateUploadedRedactionRun,
  useRedactionDocumentText,
  useRedactionOutput,
  useRedactionRun,
  useSpanDecision,
} from './hooks'
import { useRedactionSource } from './source-preview-hooks'
import { PdfReviewDocument } from './pdf-review-document'
import { DetectionRetryWarning } from './detection-retry-warning'
import { DetectionFailure, zeroSpanBody } from './detection-failure'
import { FinalizeDialog } from './finalize-dialog'
import { FinalizedOutput } from './finalized-output'
import { DecisionBar } from './decision-bar'
import {
  CategoryLegend,
  HighlightedText,
  Paper,
  categoryClasses,
} from './review-document-text'
import { ReviewPanel, type SpanFilter } from './review-panel'
import { decisionCounts, spanDecisionState } from './span-copy'
import type { RedactionRun } from './types'

function runPosition(run: RedactionRun) {
  return run.matterName ?? 'Not filed in a matter'
}

export function RedactionReviewView({
  runId,
  onOpenRun,
  onOpenDocument,
  onBack,
}: {
  runId: string
  onOpenRun: (runId: string) => void
  onOpenDocument?: (target: { matterId: string; documentId: string }) => void
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
  const replaceRun = useCreateUploadedRedactionRun()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<SpanFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const listRef = useRef<HTMLDivElement | null>(null)
  const decision = useSpanDecision(runId)

  useEffect(() => {
    if (!selectedId) return
    document
      .querySelector<HTMLElement>(`[data-span-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const failedWithoutText =
    runQuery.data?.status === 'failed' && !textQuery.data
  if (runQuery.isPending || (textQuery.isPending && !failedWithoutText)) {
    return (
      <div className="mx-auto w-full max-w-[1216px] px-12 py-14 max-compact:px-8">
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    )
  }
  if (!runQuery.data) {
    return (
      <PageScaffold title="Redaction review">
        <EmptyState
          title="This redaction run could not be loaded"
          body={
            runQuery.error?.message ??
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

  if (run.status === 'failed') {
    return (
      <PageScaffold title={run.sourceFilename} eyebrow="Redaction review">
        <DetectionFailure
          run={run}
          uploading={replaceRun.isPending}
          uploadError={replaceRun.error?.message ?? null}
          onTryAnotherFile={(file) =>
            replaceRun.mutate(file, {
              onSuccess: ({ run: next }) => onOpenRun(next.id),
            })
          }
          onBack={onBack}
        />
      </PageScaffold>
    )
  }

  if (!textQuery.data) {
    return (
      <PageScaffold title={run.sourceFilename} eyebrow="Redaction review">
        <EmptyState
          title="The document text could not be loaded"
          body={
            textQuery.error?.message ??
            'This run and its decisions are unchanged; the text they refer to could not be read.'
          }
          action={
            <Button
              variant="secondary"
              onClick={() => void textQuery.refetch()}
            >
              Try again
            </Button>
          }
        />
      </PageScaffold>
    )
  }

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

  const counts = decisionCounts(run.spans, run.decisions)
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

  const occurrences = selected
    ? sameTextOccurrences(run.spans, selected.text).length
    : 0
  const applyToAll = (decisionValue: SpanDecision) => {
    if (!selected || decision.isPending) return
    decision.mutate({
      spanId: selected.id,
      decision: decisionValue,
      applyToSameText: true,
    })
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
    if (event.ctrlKey || event.metaKey || event.altKey) return
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
              <span>{runPosition(run)}</span>
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
              onShowSpan={(spanId) => {
                setFilter('all')
                setCategoryFilter('all')
                setSourceFilter('all')
                setSelectedId(spanId)
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
        {remaining > 0 ? (
          <p className="text-caption text-subtle">{remaining} left</p>
        ) : null}
        <CategoryLegend categories={categories} />
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
                occurrences={occurrences}
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
                onApplyToAll={applyToAll}
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
