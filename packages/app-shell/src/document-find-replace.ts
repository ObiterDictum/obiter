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

/**
 * The outcome a find replace reports: the replacement landed with the caret
 * it leaves, it was refused with the canonical range reason before anything
 * mutated, or there was no hit to act on. A refused batch never half-applies:
 * every covered range is validated before the first write, and the state is
 * immutable — a mid-batch refusal returns the reason with the pre-edit state
 * untouched.
 */
export type FindReplaceResult =
  | { status: 'applied'; state: EditorState; caret: EditorCaret }
  | { status: 'refused'; refusal: DocumentRangeRefusal }
  | { status: 'empty' }

/**
 * Replaces one hit — `which` indexes the hit list — or every hit for 'all'.
 * The hits are the caller's fresh derivation for the same state passed in, so
 * an offset can never address text that is no longer there. 'all' applies in
 * reverse document order so an earlier replacement cannot shift a later
 * hit's offsets, and the inserted replacement text is never re-matched — the
 * hit list is captured before the first write.
 *
 * A hit inside one paragraph rewrites that paragraph's run text the way
 * typing does. A hit covering paragraph breaks goes through the document
 * range primitives: the covered middle paragraphs are deleted, the ends join,
 * and a range that would cross a structural paragraph, split a stored field
 * or move runs the save cannot restate is refused with the reason. A
 * replacement containing a line ending splits paragraphs through the paste
 * path, keeping the same refusal contract.
 */
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
  // A replacement containing a line ending goes through the paste path,
  // splitting paragraphs the same way a pasted selection does.
  const splitsParagraphs = /[\r\n]/.test(replacement)
  let current = state
  let caret: EditorCaret | undefined
  for (const { from, to } of selected) {
    // A hit inside one paragraph rewrites its run text like typing; a hit
    // covering breaks goes through the document range primitives — covered
    // middle paragraphs are deleted and the ends join.
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
