import {
  NO_PENDING_CHANGES,
  type PendingInlineChange,
} from './document-pending-redlines'
import type { ParagraphLinkOverlay } from './document-structure-overlays'
import type {
  DocumentChangeWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { paragraphChanges } from './document-inline-index'
import { paragraphPlainText, textDiff } from './document-model-text'

export type InlineSpan = {
  from: number
  to: number
  offset: number
  change: DocumentChangeWire
  runId: string
  tabStop: boolean
  deleted: boolean
  pending?: boolean
  editable?: boolean
  author?: string
  hyperlinkTarget?: string
}

/**
 * Tracked page and column breaks paint as labelled marks rather than line
 * breaks. Each is one code unit, like the control character it replaces, so
 * the textarea, the paint and wrap measurement agree on every offset.
 */
export const markBreaks = (text: string) =>
  text.replace(/[\f\v]/gu, (mark) => (mark === '\f' ? '\u21df' : '\u21e5'))

/** Paint runs stay out of drafts; only pending insertion characters are editable. */
function projectInlineChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
  partName?: string,
  pendingChanges: readonly PendingInlineChange[] = NO_PENDING_CHANGES,
) {
  const relevant: PendingInlineChange[] = [
    ...paragraphChanges(paragraph, changes, partName),
    ...pendingChanges,
  ].filter((change) => change.inlinePosition && change.kind !== 'property')
  const pending = relevant.filter((change) => change.pending)
  const paragraphDeleted = pending.some(
    (change) => change.pending?.paragraphDelete,
  )
  const runIds = new Set(paragraph.runs.map((run) => run.id))
  const byRun = new Map<string | null, PendingInlineChange[]>()
  for (const change of relevant) {
    if (change.pending && !change.pending.paragraphDelete) continue
    const anchor = change.inlinePosition?.beforeRunId
    const before = anchor && runIds.has(anchor) ? anchor : null
    const bucket = byRun.get(before) ?? []
    bucket.push(change)
    byRun.set(before, bucket)
  }
  const runs: DocumentParagraphWire['runs'] = []
  const spans: InlineSpan[] = []
  const editableRuns: Array<{ from: number; to: number; displayFrom: number }> =
    []
  let offset = 0
  let displayOffset = 0
  function append(beforeRunId: string | null) {
    for (const change of byRun.get(beforeRunId) ?? []) {
      const segments = change.inlinePosition?.segments ?? [
        {
          text: change.text,
          deleted:
            change.kind === 'delete' ||
            (change.kind === 'move' && change.direction === 'from'),
          author: change.author,
        },
      ]
      for (const [index, segment] of segments.entries()) {
        const runId = `${change.id}:inline:${index}`
        const text = markBreaks(segment.text)
        runs.push({ id: runId, text, preservedXmlFragments: [] })
        spans.push({
          ...segment,
          pending: !!change.pending,
          from: displayOffset,
          to: displayOffset + text.length,
          offset,
          runId,
          tabStop: index === 0,
          change,
        })
        displayOffset += text.length
      }
    }
  }

  const emitted = new Set<string>()
  for (const run of paragraphDeleted ? [] : paragraph.runs) {
    append(run.id)
    if (run.text.length === 0) {
      runs.push(run)
      editableRuns.push({
        from: offset,
        to: offset,
        displayFrom: displayOffset,
      })
    }
    const runStart = offset
    const runEnd = runStart + run.text.length
    const boundaries = [
      ...new Set([
        runStart,
        runEnd,
        ...pending.flatMap((change) => {
          const range = change.pending
          return range
            ? [range.from, range.to].filter(
                (at) => at >= runStart && at <= runEnd,
              )
            : []
        }),
      ]),
    ].sort((a, b) => a - b)
    for (const [index, at] of boundaries.entries()) {
      for (const change of pending) {
        if (
          (change.kind !== 'delete' && !change.pending?.displayOnly) ||
          change.pending?.from !== at ||
          emitted.has(change.id)
        )
          continue
        emitted.add(change.id)
        const text = markBreaks(change.text)
        const runId = `${change.id}:inline`
        runs.push({ ...run, id: runId, text })
        spans.push({
          from: displayOffset,
          to: displayOffset + text.length,
          offset,
          change,
          runId,
          tabStop: false,
          deleted: change.kind === 'delete',
          pending: true,
        })
        displayOffset += text.length
      }
      const end = boundaries[index + 1]
      if (end === undefined) continue
      const text = run.text.slice(at - runStart, end - runStart)
      const runId = pending.length ? `${run.id}:paint:${index}` : run.id
      const change = pending.find(
        (change) =>
          change.kind === 'insert' &&
          change.pending &&
          change.pending.from <= at &&
          change.pending.to >= end,
      )
      editableRuns.push({
        from: offset,
        to: offset + text.length,
        displayFrom: displayOffset,
      })
      runs.push({ ...run, id: runId, text })
      if (change)
        spans.push({
          from: displayOffset,
          to: displayOffset + text.length,
          offset,
          change,
          runId,
          tabStop: false,
          deleted: false,
          pending: true,
          editable: true,
        })
      offset += text.length
      displayOffset += text.length
    }
  }
  append(null)
  const projected = { ...paragraph, runs }
  const text = paragraphPlainText(projected)
  const editableText = paragraphDeleted ? '' : paragraphPlainText(paragraph)
  const toEditable = (at: number) => {
    let removed = 0
    for (const span of spans)
      if (!span.editable)
        removed += Math.max(0, Math.min(at, span.to) - span.from)
    return at - removed
  }
  const toDisplay = (at: number, side?: 'before' | 'after') => {
    // replaceRunRange writes into the first run ending at the offset. Match
    // that affinity so typing at an opaque gap paints where the caret sits.
    if (side === undefined) {
      const pendingEdge = spans
        .filter((span) => span.pending && !span.editable && span.offset === at)
        .at(-1)
      if (pendingEdge) return pendingEdge.to
      const run = editableRuns.find((run) => run.to >= at)
      return run ? run.displayFrom + at - run.from : text.length
    }
    let added = 0
    for (const span of spans) {
      if (span.editable) continue
      if (span.offset < at || (span.offset === at && side === 'after'))
        added += span.to - span.from
    }
    return at + added
  }
  return {
    paragraph: projected,
    text,
    editableText,
    spans,
    toEditable,
    toDisplay,
  }
}
export type InlineProjection = ReturnType<typeof projectInlineChanges>
type ProjectionCache = WeakMap<
  readonly DocumentChangeWire[],
  WeakMap<DocumentParagraphWire, Map<string, InlineProjection>>
>
const projections = new WeakMap<
  readonly PendingInlineChange[],
  ProjectionCache
>()

export function inlineChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
  partName?: string,
  pendingChanges: readonly PendingInlineChange[] = NO_PENDING_CHANGES,
): InlineProjection {
  let cache = projections.get(pendingChanges)
  if (!cache) {
    cache = new WeakMap()
    projections.set(pendingChanges, cache)
  }
  let paragraphs = cache.get(changes)
  if (!paragraphs) {
    paragraphs = new WeakMap()
    cache.set(changes, paragraphs)
  }
  let parts = paragraphs.get(paragraph)
  if (!parts) {
    parts = new Map()
    paragraphs.set(paragraph, parts)
  }
  const key = partName ?? ''
  let projection = parts.get(key)
  if (!projection) {
    projection = projectInlineChanges(
      paragraph,
      changes,
      partName,
      pendingChanges,
    )
    parts.set(key, projection)
  }
  return projection
}

/** The editing textarea hides the paint, so it names who revised the
 * paragraph; Escape leaves the textarea for the revisions themselves. */
export function inlineDescription({ spans }: InlineProjection) {
  const authors = new Set(
    spans
      .filter((span) => !span.pending)
      .map((span) => span.author ?? 'Unknown author'),
  )
  const descriptions = authors.size
    ? [`Tracked changes by ${[...authors].join(', ')}`]
    : []
  if (spans.some((span) => span.pending))
    descriptions.push('Unsaved tracked changes')
  return descriptions.join('. ') || undefined
}

export function inlineSlice(
  projection: InlineProjection,
  from: number,
  to: number,
) {
  const start = projection.toEditable(from)
  const end = projection.toEditable(to)
  const text = projection.text.slice(from, to)
  const editableText = projection.editableText.slice(start, end)
  const toEditable = (at: number) => projection.toEditable(from + at) - start
  const toDisplay = (at: number) =>
    Math.max(0, Math.min(to - from, projection.toDisplay(start + at) - from))
  return {
    text,
    editableText,
    toEditable,
    toDisplay,
    edit(next: string) {
      const diff = textDiff(text, next)
      return (
        editableText.slice(0, toEditable(diff.from)) +
        diff.insert +
        editableText.slice(toEditable(diff.to))
      )
    },
  }
}
export type InlineSlice = ReturnType<typeof inlineSlice>

export function inlineLinkOverlay(
  projection: InlineProjection,
  overlay?: ParagraphLinkOverlay,
) {
  if (!overlay) return undefined
  return {
    links: overlay.links.map((link) => ({
      ...link,
      from: projection.toDisplay(link.from, 'after'),
      to: projection.toDisplay(link.to, 'before'),
    })),
    marks: overlay.marks.map((mark) => ({
      from: projection.toDisplay(mark.from, 'after'),
      to: projection.toDisplay(mark.to, 'before'),
    })),
    fieldMarkers: overlay.fieldMarkers.map((marker) => ({
      ...marker,
      offset: projection.toDisplay(marker.offset),
    })),
  }
}
