import { z } from 'zod'

import type { DraftStorage } from './document-draft-identity'

const citationStyleSchema = z.enum(['oscola', 'house'])
export type CitationStyle = z.infer<typeof citationStyleSchema>

const KEY_PREFIX = 'obiter.citation-style.v1.'

export function readCitationStyle(
  storage: DraftStorage,
  documentId: string,
): CitationStyle {
  try {
    const raw = storage.getItem(`${KEY_PREFIX}${documentId}`)
    const parsed = citationStyleSchema.safeParse(raw)
    return parsed.success ? parsed.data : 'oscola'
  } catch {
    return 'oscola'
  }
}

export function writeCitationStyle(
  storage: DraftStorage,
  documentId: string,
  style: CitationStyle,
) {
  try {
    storage.setItem(`${KEY_PREFIX}${documentId}`, style)
  } catch {
    // Storage-full or private-mode refusals leave the session's choice in
    // memory; the document itself is unaffected.
  }
}
