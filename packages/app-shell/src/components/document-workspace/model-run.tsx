import type {
  InlineSpan,
  InlineProjection,
} from '../../document-inline-changes'
import { InlineChange } from './inline-change-review'
import { TRACKED_DELETE_MARK, TRACKED_INSERT_MARK } from './tracked-marks'
import { createContext, use, useMemo, type ReactNode } from 'react'
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
import { textWidthPx, type WrappedLine } from '../../document-page-flow'
import { readableRunColor, runDisplayText } from '../../document-page-media'
import { DEFAULT_TAB_STOP_PX, tabAdvancePx } from '../../document-page-tabs'
import { noteNumberKey, runNoteRefs } from '../../document-page-notes'
import { runCss, runFace, type ParagraphFace } from '../../document-page-style'
import { DocumentRunPaintContext } from './document-run-paint'
import { rangedParts, selectedStyle } from './model-run-ranges'
import { FootnoteReference } from './footnote-navigation'

export const NoteNumbersContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
)

export type ParagraphSelectionRange = { from: number; to: number }

export function ParagraphRunPaint({
  paragraph,
  toEditableOffset = (at) => at,
  inlineSpans = [],
  runSources,
  reviewable = true,
  hideText = false,
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
  indentFirstPx,
  pageNumber = 1,
  pageReferences,
}: {
  paragraph: DocumentParagraphWire
  toEditableOffset?: (at: number) => number
  inlineSpans?: InlineSpan[]
  runSources?: InlineProjection['runSources']
  reviewable?: boolean
  hideText?: boolean
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
  linkOverlay?: ParagraphLinkOverlay
  carets?: DocumentPresence[]
  continuation?: boolean
  indentFirstPx?: number
  pageNumber?: number
  pageReferences?: ReadonlyMap<string, number>
}) {
  const paragraphEnd = paragraphPlainText(paragraph).length
  const inlineByRun = new Map(inlineSpans.map((span) => [span.runId, span]))
  const stops = face.tabStopsPx ?? []
  const paint = (slices: PaintedSlice[], columnStartPx: number) => {
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
    let columnPx = columnStartPx
    return slices.flatMap(({ run, text, from, runFrom }) => {
      const span = inlineByRun.get(run.id)
      const source = runSources?.get(run.id)
      const original = source?.run ?? run
      const runMetrics = runFace(original, face, styles)
      const content = (piece: string, pieceFrom: number) => {
        const inner = (
          <ModelRun
            key={`${run.id}-${pieceFrom}`}
            run={original}
            paragraphId={paragraph.id}
            runFrom={
              span || runFrom === undefined
                ? undefined
                : pieceFrom - from + runFrom
            }
            hideText={hideText}
            revision={
              span?.pending ? (span.deleted ? 'delete' : 'insert') : undefined
            }
            text={piece}
            from={pieceFrom}
            notesVisible={
              (!span || span.editable) &&
              (!source || pieceFrom + piece.length === source.to)
            }
            selection={span && !span.editable ? undefined : selection}
            linkOverlay={span && !span.editable ? undefined : linkOverlay}
            paragraphEnd={paragraphEnd}
            paragraphFace={face}
            changes={changes}
            styles={styles}
            drafts={drafts}
            caret={
              (!span || span.editable) && (!source || pieceFrom === source.from)
                ? carets.find((item) => item.cursor?.runId === original.id)
                : undefined
            }
          />
        )
        return span ? (
          <InlineChange
            key={`${run.id}-${pieceFrom}`}
            span={span}
            text={piece}
            tabStop={
              reviewable &&
              span.tabStop &&
              pieceFrom === span.from &&
              piece.length > 0
            }
          >
            {span.pending ? inner : undefined}
          </InlineChange>
        ) : (
          inner
        )
      }
      const nodes: ReactNode[] = []
      const pieces = text.split('\t')
      for (const [index, piece] of pieces.entries()) {
        if (index > 0) {
          const advance = tabAdvancePx(
            columnPx,
            stops,
            face.tabStopPx ?? DEFAULT_TAB_STOP_PX,
          )
          nodes.push(
            <span
              key={`${run.id}-tab-${from + index}`}
              data-tab-stop={Math.round(columnPx + advance)}
              data-selected-text={
                selection &&
                from + index >= selection.from &&
                from + index < selection.to
                  ? 'true'
                  : undefined
              }
              className="inline-block h-[1em] align-baseline"
              style={{
                width: advance,
                backgroundColor:
                  selection &&
                  from + index >= selection.from &&
                  from + index < selection.to
                    ? selectedStyle.backgroundColor
                    : undefined,
              }}
            />,
          )
          columnPx += advance
        }
        const pieceFrom = from + index + pieces.slice(0, index).join('').length
        if (piece || pieces.length === 1) {
          nodes.push(content(piece, pieceFrom))
          columnPx += textWidthPx(
            piece,
            runMetrics.fontSizePx ?? face.run.fontSizePx ?? linePx,
            runMetrics.fontFamily ?? face.run.fontFamily,
          )
        }
      }
      return nodes
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
          index === 0 && !continuation && start === 0
            ? (indentFirstPx ?? 0)
            : 0,
        )}
      </div>
    ))
  }
  return paint(
    paintSlices(paragraph, start, end, pageNumber, pageReferences),
    start === 0 ? (indentFirstPx ?? 0) : 0,
  )
}

type PaintedSlice = RunSlice & { runFrom?: number }

function paintSlices(
  paragraph: DocumentParagraphWire,
  from: number,
  to: number,
  pageNumber: number,
  pageReferences?: ReadonlyMap<string, number>,
): PaintedSlice[] {
  const length = paragraph.runs.reduce((n, run) => n + run.text.length, 0)
  const slices: PaintedSlice[] = []
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
    if (
      start === end &&
      runNoteRefs(run.preservedXmlFragments.join(''), run.id).length > 0
    ) {
      if (start === 0 ? from === 0 : start > from && start <= to)
        slices.push({ run, text: '', from: start })
      continue
    }
    if (end <= from || start >= to) continue
    const sliceFrom = start + Math.max(0, from - start)
    slices.push({
      run,
      text: run.text.slice(Math.max(0, from - start), Math.max(0, to - start)),
      from: sliceFrom,
      runFrom: sliceFrom - start,
    })
  }
  return slices
}

function ModelRun({
  run,
  paragraphId,
  runFrom,
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
  hideText,
  revision,
}: {
  run: DocumentTextRunWire
  paragraphId: string
  runFrom?: number
  text: string
  from: number
  selection?: ParagraphSelectionRange
  linkOverlay?: ParagraphLinkOverlay
  paragraphEnd: number
  paragraphFace: ParagraphFace
  changes: DocumentChangeWire[]
  styles: DocumentStyleWire[]
  drafts?: Record<string, string>
  caret?: DocumentPresence
  notesVisible?: boolean
  hideText: boolean
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
  const numbers = use(NoteNumbersContext)
  const showNotes = notesVisible && notes.length > 0
  const paint = use(DocumentRunPaintContext)
  const renderText = (piece: string, offset: number) =>
    rangedParts(
      piece,
      from + offset,
      paragraphEnd,
      selection,
      linkOverlay,
      run.hyperlinkTarget,
    )
  const content =
    paint && runFrom !== undefined && !hideText
      ? paint(paragraphId, run.id, text, runFrom, renderText)
      : renderText(text, 0)
  return (
    <span
      aria-hidden={(hideText && !showNotes) || undefined}
      className={cn(
        'relative',
        kinds.has('insert') && TRACKED_INSERT_MARK,
        kinds.has('delete') && TRACKED_DELETE_MARK,
        kinds.has('move') && 'underline decoration-dotted decoration-[#4a6f8a]',
        kinds.has('property') &&
          'underline decoration-dotted decoration-[#8a6a2a]',
      )}
      style={runCss({
        ...face,
        color: revision ? 'inherit' : readableRunColor(face.color),
        ...(notes.length ? { vertAlign: 'baseline' as const } : {}),
      })}
    >
      {caret ? <PresenceCaret userId={caret.userId} /> : null}
      {hideText && showNotes ? (
        <span aria-hidden="true">{content}</span>
      ) : (
        content
      )}
      {(showNotes ? notes : []).map((note) => (
        <FootnoteReference
          key={`${note.kind}-${note.noteId}-${note.runId}`}
          note={note}
          mark={numbers.get(noteNumberKey(note.kind, note.noteId)) ?? note.mark}
        />
      ))}
    </span>
  )
}

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
