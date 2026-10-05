/**
 * Undo grouping for the document editor. A run of single-character typing in
 * one paragraph is one undo step; everything structural (Enter, delete,
 * paste, cut, a formatting toggle) is its own. This module is the pure rule;
 * `document-editor-history.ts` holds the state it is applied to.
 */

/** The edit a history checkpoint is about to record, as far as grouping cares. */
export type HistoryEdit =
  | { kind: 'typing'; paragraphId: string; inserted: string }
  | { kind: 'structural' }

/** The open typing run the next keystroke may join. */
export type TypingGroup = {
  paragraphId: string
  /** The last character inserted, so a word boundary can end the run. */
  last: string
  /** When that character landed, for the time window. */
  at: number
}

/**
 * How long a typing run may pause before the next keystroke starts a new undo
 * step. Long enough to cover normal typing, short enough that a pause reads as
 * a deliberate break.
 */
export const TYPING_GROUP_WINDOW_MS = 1_000

function isSingleCharacter(text: string): boolean {
  // A single code point, not a UTF-16 unit: an emoji is one keystroke.
  return [...text].length === 1
}

function isWordBoundary(text: string): boolean {
  return /\s/u.test(text)
}

/**
 * Whether an edit continues the open typing run, so it needs no new history
 * snapshot. It does when the run is in the same paragraph, the pause is inside
 * the window, and the previous keystroke did not end a word: the character
 * after a space starts a fresh step, while the space itself still closes the
 * word it followed. A multi-character insertion (an IME commit, a drop) is
 * never coalesced and always starts its own step.
 */
export function continuesTypingGroup(
  group: TypingGroup | null,
  edit: HistoryEdit,
  now: number,
): boolean {
  if (!group || edit.kind !== 'typing') return false
  if (group.paragraphId !== edit.paragraphId) return false
  if (now - group.at > TYPING_GROUP_WINDOW_MS) return false
  if (!isSingleCharacter(edit.inserted)) return false
  return !isWordBoundary(group.last)
}

/** The group a typing edit leaves open, or null when it starts no run. */
export function nextTypingGroup(
  edit: HistoryEdit,
  now: number,
): TypingGroup | null {
  if (edit.kind !== 'typing') return null
  if (!isSingleCharacter(edit.inserted)) return null
  return { paragraphId: edit.paragraphId, last: edit.inserted, at: now }
}
