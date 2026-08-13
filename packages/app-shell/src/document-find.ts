import type { DocumentModelWire } from '@obiter/contracts'
import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from './document-edits'
import { documentStory, paragraphPlainText } from './document-model-text'

export type FindHit = {
  paragraphId: string
  start: number
  end: number
}

export function findInDocument(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: readonly string[],
  query: string,
): FindHit[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const hits: FindHit[] = []
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  for (const id of flowParagraphIds(model, inserts, [...deletedParagraphIds])) {
    const insert = insertById.get(id)
    const paragraph = documentStory(model)?.paragraphs.find(
      (item) => item.id === id,
    )
    const haystack = (
      insert
        ? insertPlainText(insert)
        : paragraph
          ? paragraphPlainText(paragraph, drafts)
          : ''
    ).toLocaleLowerCase()
    let from = 0
    while (from <= haystack.length) {
      const start = haystack.indexOf(needle, from)
      if (start === -1) break
      hits.push({ paragraphId: id, start, end: start + needle.length })
      from = start + Math.max(1, needle.length)
    }
  }
  return hits
}

export function nextFindIndex(hits: readonly FindHit[], current: number) {
  if (hits.length === 0) return -1
  if (current < 0 || current >= hits.length - 1) return 0
  return current + 1
}

export function previousFindIndex(hits: readonly FindHit[], current: number) {
  if (hits.length === 0) return -1
  if (current <= 0) return hits.length - 1
  return current - 1
}

export function findMatchLabel(index: number, count: number) {
  if (count === 0 || index < 0) return `${count} found`
  return `${index + 1}/${count}`
}
