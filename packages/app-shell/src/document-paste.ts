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

export type PasteTarget =
  | { kind: 'caret'; caret: EditorCaret }
  | { kind: 'range'; from: EditorCaret; to: EditorCaret }

export type PasteOutcome =
  | { status: 'applied'; state: EditorState; caret: EditorCaret }
  | { status: 'refused'; refusal: DocumentRangeRefusal }
  | { status: 'empty' }

export function splitPasteLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n')
}

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
