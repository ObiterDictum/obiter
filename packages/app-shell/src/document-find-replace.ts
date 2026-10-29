import type { DocumentModelWire } from '@obiter/contracts'
import type { FindHit } from './document-find'
import { applyPasteText } from './document-paste'
import {
  applyReplaceDocumentRange,
  documentRangeRefusal,
  type DocumentRangeRefusal,
} from './document-range-edits'
import {
  applyReplaceRange,
  type EditorCaret,
  type EditorState,
} from './document-word-edits'

export type FindReplaceResult =
  | { status: 'applied'; state: EditorState; caret: EditorCaret }
  | { status: 'refused'; refusal: DocumentRangeRefusal }
  | { status: 'empty' }

export function replaceFindHits(
  model: DocumentModelWire,
  state: EditorState,
  hits: readonly FindHit[],
  replacement: string,
  which: number | 'all',
  newParagraphId: () => string,
): FindReplaceResult {
  const selected =
    which === 'all' ? [...hits].reverse() : hits.slice(which, which + 1)
  if (!selected.length) return { status: 'empty' }
  for (const { from, to } of selected) {
    if (from.paragraphId === to.paragraphId) continue
    const refusal = documentRangeRefusal(model, state, from, to)
    if (refusal) return { status: 'refused', refusal }
  }
  const splitsParagraphs = /[\r\n]/.test(replacement)
  let current = state
  let caret: EditorCaret | undefined
  for (const { from, to } of selected) {
    if (splitsParagraphs) {
      const outcome = applyPasteText(
        model,
        current,
        { kind: 'range', from, to },
        replacement,
        newParagraphId,
      )
      if (outcome.status === 'refused') return outcome
      if (outcome.status === 'applied') {
        current = outcome.state
        caret = outcome.caret
      } else {
        caret = from
      }
      continue
    }
    const result =
      from.paragraphId === to.paragraphId
        ? applyReplaceRange(
            model,
            current,
            from.paragraphId,
            from.offset,
            to.offset,
            replacement,
          )
        : applyReplaceDocumentRange(model, current, from, to, replacement)
    if (!result) {
      return {
        status: 'refused',
        refusal: documentRangeRefusal(model, current, from, to) ?? 'structure',
      }
    }
    current = result.state
    caret = result.caret
  }
  return caret
    ? { status: 'applied', state: current, caret }
    : { status: 'empty' }
}
