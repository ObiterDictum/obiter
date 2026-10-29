import type {
  InlineSpan,
  InlineProjection,
} from '../../document-inline-changes'
import { InlineChange } from './inline-change-review'
import { TRACKED_DELETE_MARK, TRACKED_INSERT_MARK } from './tracked-marks'
import { useMemo, type ReactNode } from 'react'
import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentPresence,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import {
  paragraphPlainText,
  runChangeKinds,
  type RunSlice,
} from '../../document-model-text'
import type { ParagraphLinkOverlay } from '../../document-structure-overlays'
import type { WrappedLine } from '../../document-page-flow'
import { readableRunColor, runDisplayText } from '../../document-page-media'
import { runNoteRefs } from '../../document-page-notes'
import { runCss, runFace } from '../../document-page-style'
import type { ParagraphFace } from '../../document-page-style'

const SELECTION_PAINT = '#b8d4f5'

export type ParagraphSelectionRange = { from: number; to: number }

type ParagraphFieldMarker = { offset: number; label: string }

type LinkOverlay = ParagraphLinkOverlay

export function ParagraphRunPaint({
  paragraph,
  toEditableOffset = (at) => at,
  inlineSpans = [],
  runSources,
  reviewable = true,
  drafts,
  changes,
  styles,
  face,
  start,
  end,
  lines,
  linePx,
  wrapWidthPx,
  selection,
  linkOverlay,
  carets = [],
  continuation = false,
  pageNumber = 1,
  pageReferences,
}: {
  paragraph: DocumentParagraphWire
  toEditableOffset?: (at: number) => number
  inlineSpans?: InlineSpan[]
  runSources?: InlineProjection['runSources']
  reviewable?: boolean
  drafts?: Record<string, string>
  changes: DocumentChangeWire[]
  styles: DocumentStyleWire[]
  face: ParagraphFace
  start: number
  end: number
  lines: WrappedLine[]
  linePx: number
  wrapWidthPx?: number
  selection?: ParagraphSelectionRange
  linkOverlay?: LinkOverlay
  carets?: DocumentPresence[]
  continuation?: boolean
  pageNumber?: number
  pageReferences?: ReadonlyMap<string, number>
}) {
  const paragraphEnd = paragraphPlainText(paragraph).length
  const inlineByRun = new Map(inlineSpans.map((span) => [span.runId, span]))
  const paint = (slices: RunSlice[]) => {
    if (slices.length === 0) {
      return (
        <span
          data-empty-line
          data-selected-text={selection ? 'true' : undefined}
        >
          &nbsp;
        </span>
      )
    }
    return slices.map(({ run, text, from }) => {
      const span = inlineByRun.get(run.id)
      const source = runSources?.get(run.id)
      const original = source?.run ?? run
      const content = (
        <ModelRun
          key={`${run.id}-${from}`}
          run={original}
          revision={
            span?.pending ? (span.deleted ? 'delete' : 'insert') : undefined
          }
          text={text}
          from={from}
          notesVisible={
            (!span || span.editable) &&
            (!source || from + text.length === source.to)
          }
          selection={span && !span.editable ? undefined : selection}
          linkOverlay={span && !span.editable ? undefined : linkOverlay}
          paragraphEnd={paragraphEnd}
          paragraphFace={face}
          changes={changes}
          styles={styles}
          drafts={drafts}
          caret={
            (!span || span.editable) && (!source || from === source.from)
              ? carets.find((item) => item.cursor?.runId === original.id)
              : undefined
          }
        />
      )
      return span ? (
        <InlineChange
          key={`${run.id}-${from}`}
          span={span}
          text={text}
          tabStop={reviewable && span.tabStop && from === span.from}
        >
          {span.pending ? content : undefined}
        </InlineChange>
      ) : (
        content
      )
    })
  }
  if (wrapWidthPx && wrapWidthPx > 0) {
    return lines.map((line, index) => (
      <div
        key={`${paragraph.id}-${line.from}-${index}`}
        className="whitespace-pre"
        style={{
          lineHeight: `${linePx}px`,
          height: linePx,
          textIndent:
            index === 0 && !continuation && start === 0 ? undefined : 0,
        }}
        data-line-from={toEditableOffset(start + line.from)}
        data-line-to={toEditableOffset(start + line.to)}
      >
        {paint(
          paintSlices(
            paragraph,
            start + line.from,
            start + line.to,
            pageNumber,
            pageReferences,
          ),
        )}
      </div>
    ))
  }
  return paint(paintSlices(paragraph, start, end, pageNumber, pageReferences))
}

function paintSlices(
  paragraph: DocumentParagraphWire,
  from: number,
  to: number,
  pageNumber: number,
  pageReferences?: ReadonlyMap<string, number>,
): RunSlice[] {
  const length = paragraph.runs.reduce((n, run) => n + run.text.length, 0)
  const slices: RunSlice[] = []
  let cursor = 0
  for (const run of paragraph.runs) {
    const start = cursor
    const end = start + run.text.length
    cursor = end
    const display = runDisplayText(run, pageNumber, pageReferences)
    if (display !== run.text) {
      if (
        start >= from &&
        (start < to || (start === length && to === length))
      ) {
        slices.push({ run, text: display, from: start })
      }
      continue
    }
    if (end <= from || start >= to) continue
    const sliceFrom = start + Math.max(0, from - start)
    slices.push({
      run,
      text: run.text.slice(Math.max(0, from - start), Math.max(0, to - start)),
      from: sliceFrom,
    })
  }
  return slices
}

function ModelRun({
  run,
  text,
  from,
  selection,
  linkOverlay,
  paragraphEnd,
  paragraphFace,
  changes,
  styles,
  drafts,
  caret,
  notesVisible = true,
  revision,
}: {
  run: DocumentTextRunWire
  text: string
  from: number
  selection?: ParagraphSelectionRange
  linkOverlay?: LinkOverlay
  paragraphEnd: number
  paragraphFace: ParagraphFace
  changes: DocumentChangeWire[]
  styles: DocumentStyleWire[]
  drafts?: Record<string, string>
  caret?: DocumentPresence
  notesVisible?: boolean
  revision?: 'insert' | 'delete'
}) {
  const face = useMemo(
    () => runFace(run, paragraphFace, styles),
    [run.preservedXmlFragments, run.styleId, paragraphFace, styles],
  )
  const kinds = useMemo(
    () => runChangeKinds(changes, run.id),
    [changes, run.id],
  )
  const notes = useMemo(
    () => runEndNotes(run, text, drafts),
    [run.preservedXmlFragments, run.id, run.text, text, drafts?.[run.id]],
  )
  const color = revision ? 'inherit' : readableRunColor(face.color)
  return (
    <span
      className={cn(
        'relative',
        kinds.has('insert') && TRACKED_INSERT_MARK,
        kinds.has('delete') && TRACKED_DELETE_MARK,
        kinds.has('move') && 'underline decoration-dotted decoration-[#4a6f8a]',
        kinds.has('property') &&
          'underline decoration-dotted decoration-[#8a6a2a]',
      )}
      style={runCss({ ...face, color })}
    >
      {caret ? <PresenceCaret userId={caret.userId} /> : null}
      {rangedParts(
        text,
        from,
        paragraphEnd,
        selection,
        linkOverlay,
        run.hyperlinkTarget,
      )}
      {(notesVisible ? notes : []).map((note) => (
        <sup
          key={`${note.kind}-${note.noteId}-${note.runId}`}
          data-note-mark
          className="text-[0.75em] leading-none"
        >
          {note.mark}
        </sup>
      ))}
    </span>
  )
}

function rangedParts(
  text: string,
  from: number,
  paragraphEnd: number,
  selection?: ParagraphSelectionRange,
  overlay?: LinkOverlay,
  storedLinkTarget?: string,
) {
  const markers = overlay?.fieldMarkers
  const links = [
    ...(overlay?.links ?? []),
    ...(storedLinkTarget
      ? [{ from, to: from + text.length, target: storedLinkTarget }]
      : []),
  ]
  const marks = overlay?.marks ?? []
  if (
    !selection &&
    links.length === 0 &&
    marks.length === 0 &&
    !markers?.length
  )
    return text
  const clamp = (offset: number) =>
    Math.max(0, Math.min(offset - from, text.length))
  const cuts = new Set<number>([0, text.length])
  if (selection) {
    cuts.add(clamp(selection.from))
    cuts.add(clamp(selection.to))
  }
  for (const link of links) {
    cuts.add(clamp(link.from))
    cuts.add(clamp(link.to))
  }
  for (const mark of marks) {
    cuts.add(clamp(mark.from))
    cuts.add(clamp(mark.to))
  }
  const markerOffsets = new Map<number, ParagraphFieldMarker[]>()
  for (const marker of markers ?? []) {
    const local = marker.offset - from
    if (local < 0 || local >= text.length) {
      if (local !== text.length || from + local !== paragraphEnd) continue
    }
    cuts.add(local)
    const list = markerOffsets.get(local) ?? []
    list.push(marker)
    markerOffsets.set(local, list)
  }
  const boundaries = [...cuts].sort((a, b) => a - b)
  const nodes: ReactNode[] = []
  const chipsAt = (local: number) =>
    (markerOffsets.get(local) ?? []).map((marker, index) => (
      <FieldMarkerAnchor
        key={`marker-${from + local}-${index}`}
        label={marker.label}
      />
    ))
  nodes.push(...chipsAt(0))
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const a = boundaries[index] ?? 0
    const b = boundaries[index + 1] ?? text.length
    const piece = text.slice(a, b)
    const selected =
      selection !== undefined &&
      from + a >= selection.from &&
      from + b <= selection.to
    const link = links.find(
      (item) => from + a >= item.from && from + b <= item.to,
    )
    const marked = marks.some(
      (item) => from + a >= item.from && from + b <= item.to,
    )
    if (selected || link || marked) {
      nodes.push(
        <span
          key={`part-${a}`}
          data-selected-text={selected ? 'true' : undefined}
          data-link-target={link ? link.target : undefined}
          data-defined-term={marked ? 'pending' : undefined}
          title={link ? link.target : undefined}
          className={
            link
              ? 'rounded-[1px] text-[#2c4a73] underline decoration-[#2c4a73]'
              : marked
                ? 'rounded-[1px] underline decoration-double decoration-[#6a4f8a]'
                : 'rounded-[1px]'
          }
          style={selected ? selectedStyle : undefined}
        >
          {piece}
        </span>,
      )
    } else if (piece.length > 0) {
      nodes.push(piece)
    }
    nodes.push(...chipsAt(b))
  }
  return nodes
}

function FieldMarkerAnchor({ label }: { label: string }) {
  return (
    <span className="relative inline-block w-0">
      <span
        data-field-marker
        aria-hidden="true"
        className="pointer-events-none absolute -top-[1.6em] left-0 z-10 max-w-48 truncate whitespace-nowrap rounded border border-[#7a9cc6] bg-[#eef3fb] px-1 text-[0.6em] leading-4 text-[#2c4a73]"
      >
        {label}
      </span>
    </span>
  )
}

const selectedStyle = { backgroundColor: SELECTION_PAINT }

function PresenceCaret({ userId }: { userId: string }) {
  return (
    <span
      data-print-hide
      className="absolute top-0 -left-px h-full w-px bg-[#4a6f8a]"
      title={userId}
      aria-hidden="true"
    />
  )
}

function runEndNotes(
  run: { id: string; text: string; preservedXmlFragments: string[] },
  visible: string,
  drafts?: Record<string, string>,
) {
  const full = drafts?.[run.id] ?? run.text
  if (full.length > 0 && !full.endsWith(visible)) return []
  return runNoteRefs(run.preservedXmlFragments.join(''), run.id)
}
