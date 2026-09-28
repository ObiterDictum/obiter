import type { HeldChange } from '../../document-draft-store'
import {
  clearableSlots,
  hasDraftState,
  splitDraftSlots,
  type DraftSlot,
  type DraftState,
} from '../../document-save-plan'

export type DraftBundle = { state: DraftState; held: HeldChange[] }

/**
 * The bundle after moving a slot the server rejected out of live state and into
 * a held change, so the next save cannot resend it. `sent` is the state the
 * rejected request was planned from: when the slot changed after planning, the
 * held record keeps the sent content while the newer typing stays editable.
 * Returns null when the slot held nothing.
 */
export function holdSlotBundle(
  current: DraftBundle,
  slot: DraftSlot,
  record: HeldChange,
  sent: DraftState | undefined,
): DraftBundle | null {
  const base = sent ?? current.state
  const { removed } = splitDraftSlots(base, [slot])
  if (!hasDraftState(removed)) return null
  record.state = removed
  if (sent && clearableSlots([slot], sent, current.state).length === 0) {
    return { state: current.state, held: [...current.held, record] }
  }
  return {
    state: splitDraftSlots(current.state, [slot]).remaining,
    held: [...current.held, record],
  }
}
