import { z } from 'zod'

import type { DraftStorage } from './document-draft-identity'

/**
 * Per-document editor preferences held in browser storage — not document
 * content. The citation style chooses the written convention Insert
 * authority applies: `oscola` writes the citation as typed; `house` writes
 * it italicised, the product's own house convention. Neither rewrites
 * citations already in the document — the setting only shapes new
 * insertions, so changing it can never silently alter stored text.
 *
 * The key names only the document id: the value carries no matter content,
 * and a document's citation convention is not per-user state. Storage is a
 * convenience, not a record — an unreadable or unwritable store degrades to
 * the default without error, matching the draft store's posture.
 */
export const citationStyleSchema = z.enum(['oscola', 'house'])
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
