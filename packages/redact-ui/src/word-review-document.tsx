import { useEffect, useMemo, useRef, useState } from 'react'
import type { RedactionWordLayout } from '@obiter/contracts'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import {
  documentImagePartNames,
  layoutDocumentPages,
  useSourceImageUrls,
  StaticDocumentPages,
} from '@obiter/app-shell/document-render'
import {
  indexWordRanges,
  markIsVisible,
  readWordPageMarks,
  wordCoverage,
  wordRunPaint,
  type WordCoverage,
} from './word-review-marks'

const PAGE_BATCH = 3

export function WordReviewDocument({
  runId,
  layout,
  spans,
  decisions,
  selectedId,
  focusRequest,
  onSelect,
  onCoverage,
}: {
  runId: string
  layout: RedactionWordLayout
  spans: RedactionSpan[]
  decisions: Decisions
  selectedId: string | null
  focusRequest: { id: string } | null
  onSelect: (spanId: string) => void
  onCoverage: (coverage: WordCoverage) => void
}) {
  const pages = useMemo(() => layoutDocumentPages(layout.model), [layout.model])
  const ranges = useMemo(() => indexWordRanges(layout), [layout])
  const spanById = useMemo(
    () => new Map(spans.map((span) => [span.id, span])),
    [spans],
  )
  const host = useRef<HTMLDivElement>(null)
  const inspected = useRef(0)
  const painted = useRef<Parameters<typeof readWordPageMarks>[2]>(new Map())
  const revealed = useRef<{ id: string; request: typeof focusRequest } | null>(
    null,
  )
  const focusedRequest = useRef<typeof focusRequest>(null)
  const [limit, setLimit] = useState(PAGE_BATCH)
  const imageParts = useMemo(
    () => documentImagePartNames(layout.model),
    [layout.model],
  )
  const paintRun = useMemo(
    () => wordRunPaint(ranges.byRun, spanById, decisions, selectedId, onSelect),
    [ranges, spanById, decisions, selectedId, onSelect],
  )
  const images = useSourceImageUrls(
    `/api/redaction-runs/${encodeURIComponent(runId)}/source-file`,
    imageParts,
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const sheets = host.current?.querySelectorAll<HTMLElement>(
        '[data-document-sheet]',
      )
      if (!sheets) return
      const inspectingFrom = inspected.current
      for (let index = inspectingFrom; index < sheets.length; index += 1) {
        const sheet = sheets[index]
        if (sheet) readWordPageMarks(sheet, index + 1, painted.current)
      }
      inspected.current = sheets.length
      if (sheets.length < pages.length) setLimit((count) => count + PAGE_BATCH)
      else
        onCoverage(
          wordCoverage(runId, ranges.bySpan, painted.current, pages.length),
        )
    })
    return () => cancelAnimationFrame(frame)
  }, [limit, onCoverage, pages.length, ranges, runId])

  useEffect(() => {
    if (
      !selectedId ||
      (revealed.current?.id === selectedId &&
        revealed.current.request === focusRequest)
    )
      return
    const marks = host.current?.querySelectorAll<HTMLElement>(
      '[data-span-id][aria-pressed="true"]',
    )
    const mark = Array.from(marks ?? []).find((candidate) => {
      const sheet = candidate.closest<HTMLElement>('[data-document-sheet]')
      return sheet && markIsVisible(candidate, sheet)
    })
    if (!mark) return
    revealed.current = { id: selectedId, request: focusRequest }
    if (
      focusRequest?.id === selectedId &&
      focusRequest !== focusedRequest.current
    ) {
      focusedRequest.current = focusRequest
      mark.focus({ preventScroll: true })
    }
    mark.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [focusRequest, limit, selectedId])

  return (
    <div
      ref={host}
      className="relative flex h-full min-h-0 flex-col"
      aria-label="Word document"
    >
      <StaticDocumentPages
        model={layout.model}
        pages={pages}
        pageLimit={limit}
        imageUrls={images.urls}
        paintRun={paintRun}
      />
      {limit < pages.length || images.pending || images.failed ? (
        <p
          className="shrink-0 border-t border-line px-4 py-2 text-meta text-muted"
          role="status"
        >
          {limit < pages.length
            ? 'Rendering Word pages…'
            : images.pending
              ? 'Loading Word images…'
              : 'Word images could not be loaded.'}
        </p>
      ) : null}
    </div>
  )
}
