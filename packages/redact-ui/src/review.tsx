import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import { ArrowLeft, CircleNotch, ShieldCheck } from '@obiter/ui/icons'
import type { SpanDecision } from '@obiter/contracts'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { sameTextOccurrences } from '@obiter/redaction-policy'
import { isApiNotFound, PageScaffold, useCurrentUser } from '@obiter/app-shell'
import {
  useCreateUploadedRedactionRun,
  useRedactionDocumentText,
  useRetryDetection,
  useRedactionOutput,
  useRedactionRun,
  useSpanDecision,
} from './hooks'
import { useRedactionSource } from './source-preview-hooks'
import { ReviewDocumentPane } from './review-document-pane'
import type { WordCoverage } from './word-review-marks'
import { DetectionRetryWarning } from './detection-retry-warning'
import { DetectionFailure, zeroSpanBody } from './detection-failure'
import { FinalizeDialog } from './finalize-dialog'
import { FinalizedOutput } from './finalized-output'
import { DecisionBar } from './decision-bar'
import { ReviewPanel, type SpanFilter } from './review-panel'
import { ReviewSummaryRow } from './review-summary-row'
import { decisionCounts, spanDecisionState } from './span-copy'
import { hasRedactionDocumentText } from './types'

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
  const detecting =
    runQuery.data?.status === 'detecting' || runQuery.data?.status === 'pending'
  const textQuery = useRedactionDocumentText(
    runId,
    hasRedactionDocumentText(runQuery.data?.status),
  )
  const retry = useRetryDetection(runId)
  const pdfPreviewEnabled =
    !detecting &&
    runQuery.data?.status !== 'failed' &&
    runQuery.data?.sourcePreview?.kind === 'pdf' &&
    runQuery.data.sourcePreview.available
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
  const [renderedWord, setWordCoverage] = useState<WordCoverage>()
  const [wordFocus, setWordFocus] = useState<{ id: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>()
  const [pane, setPane] = useState<'page' | 'spans'>('page')
  const [filter, setFilter] = useState<SpanFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const reviewRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const focusList = useRef(false)
  const decision = useSpanDecision(runId)

  useEffect(() => {
    if (focusList.current) {
      focusList.current = false
      listRef.current?.focus({ preventScroll: true })
    }
    if (!selectedId) return
    reviewRef.current
      ?.querySelector(
        '[data-span-id]:not([data-word-ranges])[aria-pressed="true"]',
      )
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId, pane])

  const failedWithoutText =
    (runQuery.data?.status === 'failed' || detecting) && !textQuery.data
  if (
    runQuery.isPending ||
    (runQuery.data !== undefined && textQuery.isPending && !failedWithoutText)
  ) {
    return (
      <div className="mx-auto w-full max-w-[1216px] px-12 py-14 @max-pane:px-8">
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    )
  }
  if (runQuery.error && isApiNotFound(runQuery.error)) {
    return (
      <PageScaffold title="Redaction review">
        <EmptyState
          title="Redaction run not found"
          body="Check the link or your access to this run."
        />
      </PageScaffold>
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
  const wordCoverage = renderedWord?.runId === run.id ? renderedWord : undefined
  const word = run.sourcePreview?.kind === 'docx'

  if (detecting)
    return (
      <PageScaffold title={run.sourceFilename} eyebrow="Redaction review">
        <EmptyState
          title="Detecting…"
          body={
            run.detectionProgress?.total
              ? `${run.detectionProgress.completed} of ${run.detectionProgress.total} sections. This screen updates when detection finishes.`
              : 'Reading the document. You can leave this page and come back.'
          }
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
          onRetry={() => retry.mutate()}
          retrying={retry.isPending}
          retryError={retry.error?.message}
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

  const counts = decisionCounts(run.spans, run.decisions)
  const changeFilter = (apply: () => void) => {
    apply()
    setSelectedId(undefined)
  }
  const filtered = run.spans.filter(
    (span) =>
      (filter === 'all' ||
        spanDecisionState(run.decisions[span.id]?.decision) === filter) &&
      (categoryFilter === 'all' || span.category === categoryFilter) &&
      (sourceFilter === 'all' || span.source === sourceFilter),
  )
  const selected =
    selectedId === undefined
      ? filtered[0]
      : run.spans.find((span) => span.id === selectedId)
  const position = selected
    ? run.spans.findIndex((span) => span.id === selected.id) + 1
    : 0
  const pageCount =
    wordCoverage?.pageCount ?? layoutQuery.data?.pages.length ?? null
  const pageFor = (span: RedactionSpan): number | null => {
    if (word) return wordCoverage?.bySpan.get(span.id) ?? null
    const layout = layoutQuery.data
    if (!layout) return null
    const segment = layout.segments.find(
      (candidate) =>
        candidate.start <= span.start && candidate.end > span.start,
    )
    return segment ? segment.pageIndex + 1 : null
  }

  const decide = (decisionValue: SpanDecision, applyToSameText = false) => {
    if (!selected || decision.isPending) return
    decision.mutate(
      {
        spanId: selected.id,
        decision: decisionValue,
        ...(applyToSameText ? { applyToSameText } : {}),
      },
      {
        onSuccess: ({ run: updated }) => {
          const index = updated.spans.findIndex(
            (span) => span.id === selected.id,
          )
          const next = [
            ...updated.spans.slice(index + 1),
            ...updated.spans.slice(0, index),
          ].find((span) => !updated.decisions[span.id])
          if (next && !filtered.some((span) => span.id === next.id)) {
            setFilter('all')
            setCategoryFilter('all')
            setSourceFilter('all')
          }
          focusList.current = true
          setSelectedId(next?.id ?? null)
        },
      },
    )
  }

  const occurrences = selected
    ? sameTextOccurrences(run.spans, selected.text).length
    : 0
  const move = (delta: number) => {
    if (!filtered.length) return
    const index = filtered.findIndex((span) => span.id === selected?.id)
    const next =
      index < 0
        ? filtered[delta > 0 ? 0 : filtered.length - 1]
        : filtered[(index + delta + filtered.length) % filtered.length]
    if (next) setSelectedId(next.id)
  }

  const onListKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!filtered.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
  }

  const categories = Array.from(new Set(run.spans.map((span) => span.category)))

  return (
    <div ref={reviewRef} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-12 py-4 @max-pane:px-8">
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
              <span>{run.matterName ?? 'Not filed in a matter'}</span>
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

      <ReviewSummaryRow
        run={run}
        counts={counts}
        categories={categories}
        pageCount={pageCount}
      />

      {run.replacementRunId || run.detectionMode !== 'model+supplement' ? (
        <div className="shrink-0">
          <DetectionRetryWarning run={run} onOpenRun={onOpenRun} />
        </div>
      ) : null}

      {run.spans.length === 0 && !word ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-12 py-8 @max-pane:px-8">
          <EmptyState
            title="No sensitive data was detected in this document"
            body={zeroSpanBody(run)}
            icon={<ShieldCheck size={28} aria-hidden="true" />}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="hidden shrink-0 items-center gap-1 border-b border-line bg-surface px-12 py-2 @max-pane:flex @max-pane:px-8"
            role="group"
            aria-label="Review view"
          >
            <Button
              size="sm"
              variant={pane === 'page' ? 'secondary' : 'ghost'}
              aria-pressed={pane === 'page'}
              onClick={() => {
                setPane('page')
                if (word && selected) setWordFocus({ id: selected.id })
              }}
            >
              Page
            </Button>
            <Button
              size="sm"
              variant={pane === 'spans' ? 'secondary' : 'ghost'}
              aria-pressed={pane === 'spans'}
              onClick={() => setPane('spans')}
            >
              Spans
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
            <ReviewDocumentPane
              run={run}
              text={textQuery.data.text}
              selectedId={selected?.id ?? null}
              focusRequest={wordFocus}
              onSelect={setSelectedId}
              word={word}
              onWordCoverage={setWordCoverage}
              pdf={
                pdfPreviewEnabled && sourceFileQuery.data && layoutQuery.data
                  ? { file: sourceFileQuery.data, layout: layoutQuery.data }
                  : null
              }
              className={pane === 'spans' ? '@max-pane:hidden' : undefined}
            />
            {run.spans.length > 0 ? (
              <ReviewPanel
                className={pane === 'page' ? '@max-pane:hidden' : undefined}
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
                onSourceChange={(next) =>
                  changeFilter(() => setSourceFilter(next))
                }
                categories={categories}
                selectedId={selected?.id ?? null}
                onSelect={(id) => {
                  setSelectedId(id)
                  if (word) setWordFocus({ id })
                }}
                missingFromWord={
                  wordCoverage
                    ? (id) => !wordCoverage.bySpan.has(id)
                    : undefined
                }
                onKeyDown={onListKeys}
                listRef={listRef}
                pageFor={pageFor}
                pageCount={pageCount}
              />
            ) : null}
          </div>
          {run.spans.length === 0 ? (
            <p className="shrink-0 border-t border-line px-5 py-3 text-meta text-muted">
              {zeroSpanBody(run)}
            </p>
          ) : run.replacementRunId ? (
            <p className="shrink-0 border-t border-line bg-surface px-12 py-3 text-meta text-muted @max-pane:px-8">
              A newer model-detected run is available, so this run can no longer
              take decisions or be finalised. Open the replacement run above to
              continue.
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
              onApplyToAll={(value) => decide(value, true)}
            />
          )}
        </div>
      )}
    </div>
  )
}
