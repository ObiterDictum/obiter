import type { DraftStorage } from '../../document-draft-store'

/** The browser stores the draft hook persists to, or null when unavailable. */
export function draftStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function sessionDraftStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
