import type { DocumentModelWire } from '@obiter/contracts'
import type { LocalInsert } from './document-edits'
import { storyFlowOrder } from './document-story-flow'
import { blockText, type EditorState } from './document-word-edits'

export type HistoryCaret = { paragraphId: string; offset: number }

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
