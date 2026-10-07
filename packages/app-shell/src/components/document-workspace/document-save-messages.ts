import { ApiError } from '../../api'
import {
  slotLabel,
  type BlockedDraft,
  type DraftSlot,
} from '../../document-save-plan'
import type { BaselineBlockReason } from './use-save-baseline'

/** One sentence naming why a committed save's history cannot be reconciled. */
export function blockedHistoryMessage(reason: BaselineBlockReason | null) {
  switch (reason) {
    case 'newer-version':
      return 'Your change was saved, but the document moved to a newer version before the saved model could be loaded. Reloading is required to continue; it discards the in-memory undo history. Your saved change is not lost.'
    case 'reload-failed':
      return 'Your change was saved, but the saved document could not be reloaded, so the edit history cannot be reconciled. Retry the reload; the saved document is unchanged.'
    default:
      return 'Your change was saved, but the edit history for it could not be reconciled against the saved version. Reloading is required to continue; it discards the in-memory undo history, any held rejected changes and parked drafts. The saved document is unchanged.'
  }
}

export function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    return `Your changes have not been saved. ${error.message}`
  }
  return 'Your changes have not been saved. The request failed before the server committed anything.'
}

/**
 * One sentence naming what the server refused. The slot stays pending in the
 * drafts, so the next save retries it; the only way it disappears is the
 * discard affordance next to this message.
 */
export function refusedSummary(refused: readonly DraftSlot[]) {
  if (refused.length === 0) return null
  if (refused.length === 1) {
    const label = refused[0] ? slotLabel(refused[0]) : 'a change'
    return `The server rejected ${label}; it stays in your drafts and the next save will try it again.`
  }
  return `${String(refused.length)} changes were rejected by the server; they stay in your drafts and the next save will try them again.`
}

/** One sentence naming what could not be sent and what to do about it. */
export function blockedSummary(blocked: readonly BlockedDraft[]) {
  if (blocked.length === 0) return null
  if (blocked.length === 1) {
    const label = blocked[0]?.label ?? 'a change'
    return `${capitalise(label)} could not be sent because it no longer matches the document. Discard it to keep saving.`
  }
  return `${String(blocked.length)} changes could not be sent because they no longer match the document. Discard them to keep saving.`
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
