import { Fragment } from 'react'
import type { PaintDocumentRun } from '@obiter/app-shell/document-render'
import type { RedactionWordLayout } from '@obiter/contracts'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import { cn } from '@obiter/ui'
import {
  categoryClasses,
  categoryLabel,
  decisionMarkClass,
  spanDecisionState,
} from './span-copy'

type Range = RedactionWordLayout['spans'][number]['ranges'][number]
type LocatedRange = Range & { index: number; spanId: string }
export type WordCoverage = {
  runId: string
  pageCount: number
  bySpan: ReadonlyMap<string, number>
}

export function indexWordRanges(layout: RedactionWordLayout) {
  const byRun = new Map<string, LocatedRange[]>()
  const bySpan = new Map<string, LocatedRange[]>()
  let index = 0
  for (const entry of layout.spans) {
    const locations = entry.ranges.map((range) => ({
      ...range,
      index: index++,
      spanId: entry.spanId,
    }))
    for (const location of locations) {
      const run = byRun.get(location.runId) ?? []
      run.push(location)
      byRun.set(location.runId, run)
    }
    if (entry.complete) bySpan.set(entry.spanId, locations)
  }
  return { byRun, bySpan }
}

export function wordRunPaint(
  ranges: Map<string, LocatedRange[]>,
  spans: ReadonlyMap<string, RedactionSpan>,
  decisions: Decisions,
  selectedId: string | null,
  onSelect: (spanId: string) => void,
): PaintDocumentRun {
  return (paragraphId, runId, text, from, render = (value) => value) => {
    const end = from + text.length
    const hits = (ranges.get(runId) ?? []).filter(
      (range) =>
        range.paragraphId === paragraphId &&
        range.from < end &&
        range.to > from &&
        spans.has(range.spanId),
    )
    if (hits.length === 0) return render(text, 0)
    const boundaries = Array.from(
      new Set([
        from,
        end,
        ...hits.flatMap((hit) => [
          Math.max(from, hit.from),
          Math.min(end, hit.to),
        ]),
      ]),
    ).sort((a, b) => a - b)
    return boundaries.slice(0, -1).map((left, index) => {
      const right = boundaries[index + 1] ?? end
      const content = render(text.slice(left - from, right - from), left - from)
      const overlapping = hits.filter(
        (hit) => hit.from <= left && hit.to >= right,
      )
      const ids = [...new Set(overlapping.map((hit) => hit.spanId))]
      const id = ids.find((candidate) => candidate === selectedId) ?? ids[0]
      const span = id === undefined ? undefined : spans.get(id)
      if (!span) return <Fragment key={left}>{content}</Fragment>
      const selected = selectedId === span.id
      const select = () =>
        onSelect(
          (selected ? ids[(ids.indexOf(span.id) + 1) % ids.length] : span.id) ??
            span.id,
        )
      return (
        <span
          key={left}
          role="button"
          tabIndex={0}
          aria-label={`${categoryLabel[span.category]}: ${span.text}`}
          aria-pressed={selected}
          data-span-id={span.id}
          data-word-ranges={[
            left,
            right,
            ...overlapping.map((hit) => hit.index),
          ].join(' ')}
          onClick={select}
          onKeyDown={(event) => {
            if (event.key !== ' ' && (event.key !== 'Enter' || selected)) return
            event.preventDefault()
            select()
          }}
          className={cn(
            'pointer-events-auto cursor-pointer rounded-[1px] focus-visible:outline-2 focus-visible:outline-ring',
            categoryClasses[span.category],
            decisionMarkClass[spanDecisionState(decisions[span.id]?.decision)],
            selected && 'inset-ring-2 inset-ring-ring',
          )}
        >
          {content}
        </span>
      )
    })
  }
}

type PaintedRange = { from: number; to: number; page: number }

export function readWordPageMarks(
  sheet: HTMLElement,
  page: number,
  painted: Map<number, PaintedRange[]>,
) {
  for (const mark of sheet.querySelectorAll<HTMLElement>(
    '[data-word-ranges]',
  )) {
    if (!markIsVisible(mark, sheet)) continue
    const [from, to, ...indices] = (mark.dataset.wordRanges ?? '')
      .split(' ')
      .map(Number)
    if (from === undefined || to === undefined) continue
    for (const index of indices) {
      const pieces = painted.get(index) ?? []
      pieces.push({ from, to, page })
      painted.set(index, pieces)
    }
  }
}

export function markIsVisible(mark: HTMLElement, sheet: HTMLElement) {
  const rects = Array.from(mark.getClientRects())
  if (rects.length === 0 || getComputedStyle(mark).visibility === 'hidden')
    return false
  for (let parent = mark.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const clipX = ['clip', 'hidden'].includes(style.overflowX || style.overflow)
    const clipY = ['clip', 'hidden'].includes(style.overflowY || style.overflow)
    if (clipX || clipY) {
      const box = parent.getBoundingClientRect()
      if (
        rects.some(
          (rect) =>
            (clipX &&
              (rect.left < box.left - 1 || rect.right > box.right + 1)) ||
            (clipY && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)),
        )
      )
        return false
    }
    if (parent === sheet) break
  }
  return true
}

export function wordCoverage(
  runId: string,
  bySpan: Map<string, LocatedRange[]>,
  painted: Map<number, PaintedRange[]>,
  pageCount: number,
): WordCoverage {
  const bySpanPage = new Map<string, number>()
  for (const [id, ranges] of bySpan) {
    let page = Infinity
    const complete =
      ranges.length > 0 &&
      ranges.every((range) => {
        let cursor = range.from
        const pieces = (painted.get(range.index) ?? []).sort(
          (a, b) => a.from - b.from,
        )
        for (const piece of pieces) {
          if (piece.from > cursor) break
          cursor = Math.max(cursor, piece.to)
          page = Math.min(page, piece.page)
        }
        return cursor === range.to
      })
    if (complete) bySpanPage.set(id, page)
  }
  return { runId, pageCount, bySpan: bySpanPage }
}
