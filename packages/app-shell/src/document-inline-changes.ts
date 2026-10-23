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

/** Display-only projection. Neither virtual runs nor tracked text enter drafts. */
function projectInlineChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
  partName?: string,
) {
  const relevant = paragraphChanges(paragraph, changes, partName).filter(
    (change) => change.inlinePosition && change.kind !== 'property',
  )
  const runIds = new Set(paragraph.runs.map((run) => run.id))
  const byRun = new Map<string | null, DocumentChangeWire[]>()
  for (const change of relevant) {
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

  for (const run of paragraph.runs) {
    append(run.id)
    editableRuns.push({
      from: offset,
      to: offset + run.text.length,
      displayFrom: displayOffset,
    })
    runs.push(run)
    offset += run.text.length
    displayOffset += run.text.length
  }
  append(null)
  const projected = { ...paragraph, runs }
  const text = paragraphPlainText(projected)
  const editableText = paragraphPlainText(paragraph)
  const toEditable = (at: number) => {
    let removed = 0
    for (const span of spans)
      removed += Math.max(0, Math.min(at, span.to) - span.from)
    return at - removed
  }
  const toDisplay = (at: number, side?: 'before' | 'after') => {
    // replaceRunRange writes into the first run ending at the offset. Match
    // that affinity so typing at an opaque gap paints where the caret sits.
    if (side === undefined) {
      const run = editableRuns.find((run) => run.to >= at)
      return run ? run.displayFrom + at - run.from : text.length
    }
    let added = 0
    for (const span of spans) {
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
const projections = new WeakMap<
  readonly DocumentChangeWire[],
  WeakMap<DocumentParagraphWire, Map<string, InlineProjection>>
>()

export function inlineChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
  partName?: string,
): InlineProjection {
  let paragraphs = projections.get(changes)
  if (!paragraphs) {
    paragraphs = new WeakMap()
    projections.set(changes, paragraphs)
  }
  let parts = paragraphs.get(paragraph)
  if (!parts) {
    parts = new Map()
    paragraphs.set(paragraph, parts)
  }
  const key = partName ?? ''
  let projection = parts.get(key)
  if (!projection) {
    projection = projectInlineChanges(paragraph, changes, partName)
    parts.set(key, projection)
  }
  return projection
}

/** The editing textarea hides the paint, so it names who revised the
 * paragraph; Escape leaves the textarea for the revisions themselves. */
export function inlineDescription({ spans }: InlineProjection) {
  const authors = new Set(spans.map((span) => span.author ?? 'Unknown author'))
  return spans.length
    ? `Tracked changes by ${[...authors].join(', ')}`
    : undefined
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
