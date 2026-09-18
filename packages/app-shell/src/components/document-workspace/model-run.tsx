import { useMemo } from 'react'
import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentPresence,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import {
  runChangeKinds,
  sliceParagraphRuns,
  type RunSlice,
} from '../../document-model-text'
import type { WrappedLine } from '../../document-page-flow'
import { readableRunColor } from '../../document-page-media'
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
 * Paints one paragraph's runs, marking the part a document selection covers.
 * `start`/`end` are the block's slice of the paragraph, so a paragraph split
 * across pages highlights only the code units this block owns.
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
  carets = [],
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
  carets?: DocumentPresence[]
}) {
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
        style={{ lineHeight: `${linePx}px`, height: linePx }}
        data-line-from={start + line.from}
        data-line-to={start + line.to}
      >
        {line.text
          ? paint(
              sliceParagraphRuns(
                paragraph,
                start + line.from,
                start + line.to,
                drafts,
              ),
            )
          : paint([])}
      </div>
    ))
  }
  return paint(sliceParagraphRuns(paragraph, start, end, drafts))
}

function ModelRun({
  run,
  text,
  from,
  selection,
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
      {selectedParts(text, from, selection)}
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

/** Splits a run slice into the unselected and selected parts of the range. */
function selectedParts(
  text: string,
  from: number,
  selection?: ParagraphSelectionRange,
) {
  if (!selection) return text
  const start = Math.max(0, Math.min(selection.from - from, text.length))
  const end = Math.max(0, Math.min(selection.to - from, text.length))
  if (start >= end) return text
  return (
    <>
      {text.slice(0, start)}
      <span data-selected-text className="rounded-[1px]" style={selectedStyle}>
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
    </>
  )
}

const selectedStyle = { backgroundColor: SELECTION_PAINT }

function PresenceCaret({ userId }: { userId: string }) {
  return (
    <span
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
