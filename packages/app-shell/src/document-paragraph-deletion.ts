import type { DocumentModelWire } from '@obiter/contracts'
import {
  paragraphDeletionRefusal,
  removeInsert,
  type LocalInsert,
  type ParagraphDeletionRefusal,
} from './document-edits'
import { storyFlowOrder } from './document-story-flow'

type ParagraphDeletionState = {
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
}

export type ParagraphDeletionPlan =
  | { kind: 'deleted'; selectId: string | null; state: ParagraphDeletionState }
  | { kind: 'refused'; reason: ParagraphDeletionRefusal }
  | { kind: 'unchanged' }

export function planParagraphDeletion(
  model: DocumentModelWire | undefined,
  state: {
    inserts: readonly LocalInsert[]
    deletedParagraphIds: readonly string[]
  },
  paragraphId: string,
): ParagraphDeletionPlan {
  if (!model) return { kind: 'refused', reason: 'last-paragraph' }
  const refusal = paragraphDeletionRefusal(
    model,
    state.inserts,
    state.deletedParagraphIds,
    paragraphId,
  )
  if (refusal) {
    return { kind: 'refused', reason: refusal }
  }
  const removed = removeInsert([...state.inserts], paragraphId)
  if (removed) {
    const order = storyFlowOrder(
      model,
      state.inserts,
      state.deletedParagraphIds,
      paragraphId,
    )
    const index = order.indexOf(paragraphId)
    const effective = storyFlowOrder(
      model,
      removed.inserts,
      state.deletedParagraphIds,
      removed.selectId,
    )
    const selectId = effective.includes(removed.selectId)
      ? removed.selectId
      : (effective[index] ?? effective[index - 1] ?? null)
    return {
      kind: 'deleted',
      selectId,
      state: {
        inserts: removed.inserts,
        deletedParagraphIds: [...state.deletedParagraphIds],
      },
    }
  }
  if (state.deletedParagraphIds.includes(paragraphId)) {
    return { kind: 'unchanged' }
  }
  const order = storyFlowOrder(
    model,
    state.inserts,
    state.deletedParagraphIds,
    paragraphId,
  )
  const index = order.indexOf(paragraphId)
  if (index < 0) return { kind: 'unchanged' }
  return {
    kind: 'deleted',
    selectId: order[index + 1] ?? order[index - 1] ?? null,
    state: {
      inserts: [...state.inserts],
      deletedParagraphIds: [...state.deletedParagraphIds, paragraphId],
    },
  }
}
