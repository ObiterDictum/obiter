import { emptyFormatDrafts } from './document-format-edits'
import { emptyDraftState } from './document-save-plan'
import type { DraftState } from './document-save-plan'
import type { DraftScope, DraftStorage } from './document-draft-store'

export class MapStorage implements DraftStorage {
  readonly entries = new Map<string, string>()
  failWrites = false
  failReads = false

  get length() {
    return this.entries.size
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    if (this.failReads) throw new Error('storage unavailable')
    return this.entries.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.entries.set(key, value)
  }
  removeItem(key: string) {
    this.entries.delete(key)
  }
}

export const scope: DraftScope = {
  organisationId: 'org_1',
  userId: 'usr_1',
  documentId: 'doc_1',
  tabId: 'tab_1',
}

export function stateWithText(text: string): DraftState {
  return {
    ...emptyDraftState(),
    drafts: { r1: text },
    format: { ...emptyFormatDrafts, paragraphStyles: { p1: 'Heading1' } },
  }
}
