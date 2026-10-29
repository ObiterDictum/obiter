export type HistoryEdit =
  | { kind: 'typing'; paragraphId: string; inserted: string }
  | { kind: 'structural' }

export type TypingGroup = {
  paragraphId: string
  last: string
  at: number
}

export const TYPING_GROUP_WINDOW_MS = 1_000

function isSingleCharacter(text: string): boolean {
  return [...text].length === 1
}

function isWordBoundary(text: string): boolean {
  return /\s/u.test(text)
}

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

export function nextTypingGroup(
  edit: HistoryEdit,
  now: number,
): TypingGroup | null {
  if (edit.kind !== 'typing') return null
  if (!isSingleCharacter(edit.inserted)) return null
  return { paragraphId: edit.paragraphId, last: edit.inserted, at: now }
}
