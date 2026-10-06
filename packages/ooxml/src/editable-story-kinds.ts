import type { DocumentStoryWire } from '@obiter/contracts'

/**
 * The story kinds the edit surface can write to: the body, the
 * header/footer margin stories, and the footnotes story. Endnote and
 * comment stories stay read-only. `model-edit-plan` checks operations
 * against it and `document-identity` canonicalises paragraph identities for
 * exactly these stories — one set so an addressable paragraph always has a
 * persisted identity.
 */
export const EDITABLE_STORY_KINDS: ReadonlySet<DocumentStoryWire['kind']> =
  new Set(['document', 'header', 'footer', 'footnotes'])

/**
 * The stories a `PAGE` field resolves in: the body and the margins a page
 * number paints over. A note story has no page of its own, so a field
 * anchored there could never resolve.
 */
export const PAGE_STORY_KINDS: ReadonlySet<DocumentStoryWire['kind']> = new Set(
  ['document', 'header', 'footer'],
)
