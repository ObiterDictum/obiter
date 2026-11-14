import type { DraftState } from './document-draft-state'
import { hasSectionDraft } from './document-section-format'

export function untrackedDraftPending(state: DraftState): boolean {
  return (
    state.structures.length > 0 ||
    state.breaks.length > 0 ||
    hasSectionDraft(state.format.section)
  )
}
