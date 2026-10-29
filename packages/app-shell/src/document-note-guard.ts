import type { DocumentStoryWire } from '@obiter/contracts'
import { noteEntryGroups } from './document-page-notes'
import { resolveInsertAnchor, type LocalInsert } from './document-story-flow'

export function isNoteStory(
  story: DocumentStoryWire | undefined,
): story is DocumentStoryWire {
  return story?.kind === 'footnotes' || story?.kind === 'endnotes'
}

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
