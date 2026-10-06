import type { DocumentModelWire } from '@obiter/contracts'
import type { LocalInsert } from './document-edits'
import { storyFlowOrder } from './document-story-flow'
import { blockText, type EditorState } from './document-word-edits'

export type HistoryCaret = { paragraphId: string; offset: number }

/**
 * Where the caret goes after a history step, or null to keep it where it is.
 *
 * A step can remove the paragraph the caret was on: the insert it was inside
 * (undo of a split), or a stored paragraph it was parked on (redo of a join,
 * or of a delete). The first falls back to the paragraph the insert was
 * anchored after; the second to the nearest surviving neighbour in flow order,
 * so the editor never unmounts under an unseated caret. The step can also
 * restore an insert, which takes the caret so typing resumes inside it.
 *
 * Extracted from `use-workspace-caret` to keep that hook under the source line
 * ceiling; the placement itself is pure and does not touch React state.
 */
export function historyCaretPlacement({
  model,
  before,
  restored,
  anchor,
}: {
  model: DocumentModelWire
  before: { inserts: LocalInsert[]; deletedParagraphIds: string[] }
  restored: EditorState
  anchor: string
}): HistoryCaret | null {
  // The anchor's own story orders the fallback: a header paragraph's caret
  // falls back to a header neighbour, never across into the body.
  const order = storyFlowOrder(
    model,
    restored.inserts,
    restored.deletedParagraphIds,
    anchor,
  )
  const beforeOrder = storyFlowOrder(
    model,
    before.inserts,
    before.deletedParagraphIds,
    anchor,
  )
  const survives = order.includes(anchor)
  const gone = before.inserts.find((item) => item.clientId === anchor)
  if (gone && !survives) {
    // The step removed the insert the caret was inside. Seat it on the insert's
    // anchor when that anchor survived, otherwise on the nearest surviving
    // neighbour: the anchor itself can be gone when the same step also removed
    // the paragraph the insert was placed after.
    const fallback = order.includes(gone.afterParagraphId)
      ? gone.afterParagraphId
      : nearestSurvivingParagraph(beforeOrder, gone.afterParagraphId, order)
    return fallback
      ? {
          paragraphId: fallback,
          offset: blockText(model, restored, fallback).length,
        }
      : null
  }
  if (!survives) {
    const fallback = nearestSurvivingParagraph(beforeOrder, anchor, order)
    return fallback
      ? {
          paragraphId: fallback,
          offset: blockText(model, restored, fallback).length,
        }
      : null
  }
  const added = restored.inserts.find(
    (item) =>
      item.afterParagraphId === anchor &&
      !before.inserts.some((prior) => prior.clientId === item.clientId),
  )
  return added ? { paragraphId: added.clientId, offset: 0 } : null
}

/**
 * The nearest preceding paragraph the restored flow still renders, or the
 * nearest following one when the removed paragraph was first. Order comes from
 * the same flow the editor navigates by.
 */
function nearestSurvivingParagraph(
  before: readonly string[],
  anchor: string,
  after: readonly string[],
): string | null {
  const surviving = new Set(after)
  const index = before.indexOf(anchor)
  const start = index === -1 ? before.length : index
  for (let at = start - 1; at >= 0; at -= 1) {
    const id = before[at]
    if (id && surviving.has(id)) return id
  }
  for (let at = start; at < before.length; at += 1) {
    const id = before[at]
    if (id && surviving.has(id)) return id
  }
  return null
}
