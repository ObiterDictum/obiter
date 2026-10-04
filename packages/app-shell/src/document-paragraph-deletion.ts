import type { DocumentModelWire } from '@obiter/contracts'
import {
  flowParagraphIds,
  paragraphDeletionRefusal,
  removeInsert,
  type LocalInsert,
  type ParagraphDeletionOutcome,
} from './document-edits'

export type { ParagraphDeletionOutcome }

/** The draft fields a deletion can change. */
export type ParagraphDeletionState = {
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
}

/**
 * One planned paragraph deletion: the draft state to commit and the paragraph
 * to select, a typed refusal, or an unchanged no-op. Pure, so the invariant is
 * tested without a mounted workspace and the hook only records history and
 * commits what this returns.
 */
export type ParagraphDeletionPlan =
  | { kind: 'deleted'; selectId: string | null; state: ParagraphDeletionState }
  | { kind: 'refused' }
  | { kind: 'unchanged' }

/**
 * Plans deleting `paragraphId` from the effective document. The invariant is
 * checked before any state is returned, so a refused deletion never reaches a
 * history checkpoint or the save plan, and a deleted stored paragraph returns
 * its neighbour for the caret instead of stranding focus on the removed one.
 */
export function planParagraphDeletion(
  model: DocumentModelWire | undefined,
  state: {
    inserts: readonly LocalInsert[]
    deletedParagraphIds: readonly string[]
  },
  paragraphId: string,
): ParagraphDeletionPlan {
  if (
    !model ||
    paragraphDeletionRefusal(
      model,
      state.inserts,
      state.deletedParagraphIds,
      paragraphId,
    )
  ) {
    return { kind: 'refused' }
  }
  const removed = removeInsert([...state.inserts], paragraphId)
  if (removed) {
    // `removeInsert` names the insert's anchor, but that anchor may itself be
    // pending deletion, so it would not render. Keep it only when it survives,
    // otherwise pick the effective neighbour at the insert's former position.
    const order = flowParagraphIds(
      model,
      state.inserts,
      state.deletedParagraphIds,
    )
    const index = order.indexOf(paragraphId)
    const effective = flowParagraphIds(
      model,
      removed.inserts,
      state.deletedParagraphIds,
    )
    const selectId =
      removed.selectId !== null && effective.includes(removed.selectId)
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
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
  )
  const index = order.indexOf(paragraphId)
  // A stale id that names no paragraph in the effective flow is a no-op, not a
  // deletion: committing it would add a phantom slot that surfaces at save as
  // an already-removed deletion and dirties the document for nothing.
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
