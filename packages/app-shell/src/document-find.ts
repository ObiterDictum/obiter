import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from './document-edits'
import { documentStory, paragraphPlainText } from './document-model-text'
import type { ExtraRuns } from './document-word-edits'

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
  extraRuns: ExtraRuns = {},
  query: string,
): FindHit[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const hits: FindHit[] = []
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const paragraphsById = new Map(
    documentStory(model)?.paragraphs.map((item) => [item.id, item]) ?? [],
  )
  for (const id of flowParagraphIds(model, inserts, [...deletedParagraphIds])) {
    const insert = insertById.get(id)
    const paragraph = paragraphsById.get(id)
    // Mirror what the editor renders (blockText): original runs + drafts,
    // then extraRuns for text typed into a zero-run paragraph or joined from
    // the paragraph below.
    const haystack = (
      insert
        ? insertPlainText(insert)
        : paragraph
          ? paragraphTextWithExtra(paragraph, drafts, extraRuns)
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

function paragraphTextWithExtra(
  paragraph: DocumentParagraphWire,
  drafts: Record<string, string>,
  extraRuns: ExtraRuns,
): string {
  const extra = (extraRuns[paragraph.id] ?? [])
    .map((run) => drafts[run.id] ?? run.text)
    .join('')
  return `${paragraphPlainText(paragraph, drafts)}${extra}`
}

export function clampFindIndex(index: number, count: number): number {
  if (index < 0 || count === 0 || index >= count) return -1
  return index
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
