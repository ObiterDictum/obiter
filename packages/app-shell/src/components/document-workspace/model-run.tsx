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
import type { ParagraphLinkOverlay } from '../../document-structural-drafts'
import type { WrappedLine } from '../../document-page-flow'
import { readableRunColor, runDisplayText } from '../../document-page-media'
import { runNoteRefs } from '../../document-page-notes'
import { runCss, runFace } from '../../document-page-style'
import type { ParagraphFace } from '../../document-page-style'

/**
 * The colour a selected run paints with both in the run overlay and in the
 * focused textarea's native ::selection, so a selection that spans paragraphs
 * reads as one highlight rather than a model-painted range butting against a
 * platform-painted one.
 */
export const SELECTION_PAINT = '#b8d4f5'

export type ParagraphSelectionRange = { from: number; to: number }

/**
 * A pending hyperlink painted over the text it covers, in paragraph-model
 * offsets. `target` rides along for the tooltip; the paint is a styled range
 * inside the text flow, so it aligns exactly like a selected range.
 */
export type ParagraphLinkRange = { from: number; to: number; target: string }

/**
 * A pending cross-reference: a zero-width marker anchored at `offset`. It
 * contributes no characters — the label reads the resolved target's text so
 * the chip shows what the saved field will say without entering the
 * editable stream.
 */
export type ParagraphFieldMarker = { offset: number; label: string }

type LinkOverlay = ParagraphLinkOverlay

/**
 * Paints one paragraph's runs, marking the part a document selection covers.
 * `start`/`end` are the block's slice of the paragraph, so a paragraph split
 * across pages highlights only the code units this block owns.
 *
 * `paragraph` already carries the effective text, including any range split.
 * Slicing must not apply text drafts again: a draft is the whole original
 * run, and the slice that kept that run id would repeat it.
 */
export function ParagraphRunPaint({
  paragraph,
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
}: {
  paragraph: DocumentParagraphWire
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
  /** True when this block resumes a paragraph split across a page break. */
  continuation?: boolean
  /** The page this block paints on: resolves `PAGE` fields in stored runs. */
  pageNumber?: number
}) {
  // A marker exactly at a slice's end belongs to the next slice — except at
  // the paragraph's own end, where nothing follows. The block end alone
  // cannot tell the two apart, so the paragraph's full length is the rule.
  const paragraphEnd = paragraphPlainText(paragraph).length
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
    return slices.map(({ run, text, from }) => (
      <ModelRun
        key={`${run.id}-${from}`}
        run={run}
        text={text}
        from={from}
        selection={selection}
        linkOverlay={linkOverlay}
        paragraphEnd={paragraphEnd}
        paragraphFace={face}
        changes={changes}
        styles={styles}
        drafts={drafts}
        caret={carets.find((item) => item.cursor?.runId === run.id)}
      />
    ))
  }
  if (wrapWidthPx && wrapWidthPx > 0) {
    return lines.map((line, index) => (
      <div
        key={`${paragraph.id}-${line.from}-${index}`}
        className="whitespace-pre"
        style={{
          lineHeight: `${linePx}px`,
          height: linePx,
          // The wrapper inherits the paragraph's text-indent, which would then
          // apply to the first line of every one of these wrapped blocks and so
          // indent every line. Only the paragraph's first block keeps it; the
          // rest reset it. A continuation block resumes mid-paragraph at a page
          // break, so no line on it carries the special first-line/hanging
          // indent, including its first.
          textIndent: index === 0 && !continuation ? undefined : 0,
        }}
        data-line-from={start + line.from}
        data-line-to={start + line.to}
      >
        {paint(
          paintSlices(
            paragraph,
            start + line.from,
            start + line.to,
            pageNumber,
          ),
        )}
      </div>
    ))
  }
  return paint(paintSlices(paragraph, start, end, pageNumber))
}

/**
 * The painted slices of a paragraph in `[from, to)`. Same model offsets
 * `sliceParagraphRuns` produces — text drafts are already applied to
 * `run.text` — except for a field run, whose stored text is not what the
 * field displays: this writer stores an empty result run and Word stores a
 * stale one, so the slice carries the instruction resolved through
 * `runDisplayText`. A field is zero-width in the model, so its resolved
 * text paints in the one block that owns its offset without shifting any
 * caret or selection offset.
 */
function paintSlices(
  paragraph: DocumentParagraphWire,
  from: number,
  to: number,
  pageNumber: number,
): RunSlice[] {
  const length = paragraph.runs.reduce((n, run) => n + run.text.length, 0)
  const slices: RunSlice[] = []
  let cursor = 0
  for (const run of paragraph.runs) {
    const start = cursor
    const end = start + run.text.length
    cursor = end
    const display = runDisplayText(run, pageNumber)
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
}) {
  // The run's own formatting and note refs depend on the run XML, not its
  // text, so they survive a keystroke elsewhere in the document.
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
  const color = readableRunColor(face.color)
  return (
    <span
      className={cn(
        'relative',
        kinds.has('insert') &&
          'underline decoration-[#3d7a52] underline-offset-4',
        kinds.has('delete') &&
          'text-[#9a4f3c] line-through decoration-[#9a4f3c]',
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
      {notes.map((note) => (
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

/**
 * Splits a run slice at every overlay boundary — the document selection,
 * pending hyperlink ranges and pending field markers — and paints each
 * piece with the overlays that cover it. Every boundary becomes a cut, so a
 * piece is either wholly covered by an overlay or wholly outside it; markers
 * anchor at their cut as zero-width spans that shift no glyph.
 */
function rangedParts(
  text: string,
  from: number,
  paragraphEnd: number,
  selection?: ParagraphSelectionRange,
  overlay?: LinkOverlay,
  storedLinkTarget?: string,
) {
  const markers = overlay?.fieldMarkers
  // A stored w:hyperlink wraps whole runs, so the run's target covers this
  // slice end to end; pending link drafts keep their explicit ranges and win
  // where the two overlap.
  const links = [
    ...(overlay?.links ?? []),
    ...(storedLinkTarget
      ? [{ from, to: from + text.length, target: storedLinkTarget }]
      : []),
  ]
  if (!selection && links.length === 0 && !markers?.length) return text
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
  const markerOffsets = new Map<number, ParagraphFieldMarker[]>()
  for (const marker of markers ?? []) {
    const local = marker.offset - from
    // A marker at the slice's start is this slice's; at its end it belongs
    // to the next slice — unless the slice reaches the paragraph's end.
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
    if (selected || link) {
      nodes.push(
        <span
          key={`part-${a}`}
          data-selected-text={selected ? 'true' : undefined}
          data-link-target={link ? link.target : undefined}
          title={link ? link.target : undefined}
          className={
            link
              ? 'rounded-[1px] text-[#2c4a73] underline decoration-[#2c4a73]'
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

/** The chip's anchor: zero width in flow, so no painted glyph moves. */
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
