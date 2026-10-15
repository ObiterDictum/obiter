import type { DocumentModelWire } from '@obiter/contracts'
import {
  applyReplaceDocumentRange,
  documentRangeRefusal,
  type DocumentRangeRefusal,
} from './document-range-edits'
import {
  applyInsertText,
  applyReplaceRange,
  applySplitParagraph,
  type EditorCaret,
  type EditorState,
} from './document-word-edits'

/** Where a paste lands: at a collapsed caret, or over a range. The range may
 * span paragraphs, which is what makes this different from a word edit. */
export type PasteTarget =
  | { kind: 'caret'; caret: EditorCaret }
  | { kind: 'range'; from: EditorCaret; to: EditorCaret }

/** The paste could not apply, with the canonical reason the range primitives
 * already use, or the payload was empty and nothing should change. */
export type PasteOutcome =
  | { status: 'applied'; state: EditorState; caret: EditorCaret }
  | { status: 'refused'; refusal: DocumentRangeRefusal }
  | { status: 'empty' }

/**
 * Splits pasted text into paragraphs. A clipboard line ending is CRLF or a
 * lone CR far more often than it is LF, so normalise first; the result already
 * carries a trailing empty line for a trailing newline, which is the extra
 * paragraph a word processor creates.
 */
export function splitPasteLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n')
}

/**
 * Applies a plain-text paste as one edit, reusing the single-paragraph
 * primitives and splitting the inserted text into paragraphs rather than
 * writing its newlines into one paragraph as hard breaks. The whole paste is
 * returned as one state, so the caller records one history step.
 *
 * The first line replaces the target (range or caret); every later line first
 * splits a paragraph and then inserts its text, which keeps the tail of a
 * pasted-over range attached to the last pasted line.
 */
export function applyPasteText(
  model: DocumentModelWire,
  state: EditorState,
  target: PasteTarget,
  text: string,
  newParagraphId: () => string,
): PasteOutcome {
  if (text.length === 0) return { status: 'empty' }
  const lines = splitPasteLines(text)
  const first = replaceTarget(model, state, target, lines[0] ?? '')
  if (!first.applied) return { status: 'refused', refusal: first.refusal }
  let current = first.state
  let caret = first.caret
  for (const line of lines.slice(1)) {
    const split = applySplitParagraph(model, current, caret, newParagraphId())
    if (!split) return { status: 'refused', refusal: 'structure' }
    current = split.state
    caret = split.caret
    if (line.length > 0) {
      const inserted = applyInsertText(model, current, caret, line)
      if (!inserted) return { status: 'refused', refusal: 'structure' }
      current = inserted.state
      caret = inserted.caret
    }
  }
  return { status: 'applied', state: current, caret }
}

type TargetResult =
  | { applied: true; state: EditorState; caret: EditorCaret }
  | { applied: false; refusal: DocumentRangeRefusal }

/** Replaces the paste target with the first line, through the matching
 * primitive: a same-paragraph replace, a cross-paragraph range replace, or an
 * insertion at the caret. A cross-paragraph range is refused up front with the
 * reason the range primitives publish, rather than failing without one. */
function replaceTarget(
  model: DocumentModelWire,
  state: EditorState,
  target: PasteTarget,
  first: string,
): TargetResult {
  if (target.kind === 'caret') {
    const result = applyInsertText(model, state, target.caret, first)
    return result
      ? { applied: true, state: result.state, caret: result.caret }
      : { applied: false, refusal: 'structure' }
  }
  if (target.from.paragraphId === target.to.paragraphId) {
    const result = applyReplaceRange(
      model,
      state,
      target.from.paragraphId,
      target.from.offset,
      target.to.offset,
      first,
    )
    return result
      ? { applied: true, state: result.state, caret: result.caret }
      : { applied: false, refusal: 'structure' }
  }
  const refusal = documentRangeRefusal(model, state, target.from, target.to)
  if (refusal) return { applied: false, refusal }
  const result = applyReplaceDocumentRange(
    model,
    state,
    target.from,
    target.to,
    first,
  )
  return result
    ? { applied: true, state: result.state, caret: result.caret }
    : { applied: false, refusal: 'structure' }
}
