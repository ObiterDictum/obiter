import type { DocumentStoryWire } from '@obiter/contracts'
import { noteEntryGroups } from './document-page-notes'
import { resolveInsertAnchor, type LocalInsert } from './document-story-flow'

/** The notes story kinds whose entries the paragraph boundary rules cover. */
export function isNoteStory(
  story: DocumentStoryWire | undefined,
): story is DocumentStoryWire {
  return story?.kind === 'footnotes' || story?.kind === 'endnotes'
}

/**
 * Resolves a flow id to its note-entry index inside a notes story: a stored
 * paragraph's entry is its note element's `w:p` slice — the groups
 * `noteEntryGroups` derives — and a pending insert joins the entry its
 * anchor resolves into. `-1` names a paragraph outside every entry, which
 * can neither join a neighbour inside one nor keep an entry alive.
 */
export function noteEntryResolver(
  story: DocumentStoryWire,
  inserts: readonly LocalInsert[],
  realIds: ReadonlySet<string>,
): (id: string) => number {
  const groups = noteEntryGroups(story)
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  return (id) => {
    const item = insertById.get(id)
    const resolved = item ? resolveInsertAnchor(item, insertById, realIds) : id
    return groups.findIndex((group) => group.includes(resolved))
  }
}

/**
 * Whether two flow ids sit inside the same note entry. A join may not cross
 * a note's `w:p` boundary — merging a neighbour's runs would move text
 * between entries, and merging into a separator entry would write a real
 * note onto markup the format reserves — and a deletion may not empty an
 * entry, so both rules share the one resolution.
 */
export function sameNoteEntry(
  story: DocumentStoryWire,
  inserts: readonly LocalInsert[],
  realIds: ReadonlySet<string>,
  first: string,
  second: string,
) {
  const indexOf = noteEntryResolver(story, inserts, realIds)
  const entry = indexOf(first)
  return entry !== -1 && entry === indexOf(second)
}
