import type { DocumentModelWire } from '@obiter/contracts'
import {
  appliableParkedEdits,
  reviewParkedDraftEdits,
  type ParkedDraftReview,
} from '../../document-parked-draft'
import { readDocumentDraftSnapshot } from '../../document-draft-store'
import type { DraftState } from '../../document-save-plan'
import type { DraftScope, DraftStorage } from '../../document-draft-identity'

export function useParkedDraftReview({
  storage,
  storedScope,
  model,
  currentState,
  mergeAppliable,
}: {
  storage: DraftStorage | null
  storedScope: () => DraftScope
  model: DocumentModelWire | undefined
  currentState: () => DraftState
  mergeAppliable: (appliable: ReturnType<typeof appliableParkedEdits>) => void
}) {
  function reviewParkedDraft(
    draftId: string,
    baseModel: DocumentModelWire | undefined,
  ): ParkedDraftReview | undefined {
    if (!storage || !model) return undefined
    const snapshot = readDocumentDraftSnapshot(storage, storedScope(), draftId)
    if (!snapshot) return undefined
    return reviewParkedDraftEdits(
      baseModel,
      model,
      snapshot.state,
      snapshot.held.length,
      currentState(),
    )
  }

  function applyParkedDraft(
    draftId: string,
    baseModel: DocumentModelWire | undefined,
  ): { applied: number; changed: number } | undefined {
    const review = reviewParkedDraft(draftId, baseModel)
    if (!review) return undefined
    const appliable = appliableParkedEdits(review.edits)
    if (
      Object.keys(appliable.drafts).length > 0 ||
      appliable.deletedParagraphIds.length > 0 ||
      appliable.inserts.length > 0
    ) {
      mergeAppliable(appliable)
    }
    return { applied: review.appliableCount, changed: review.changedCount }
  }

  return { reviewParkedDraft, applyParkedDraft }
}
