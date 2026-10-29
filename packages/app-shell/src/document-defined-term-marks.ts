import {
  DEFINED_TERM_NAME_PREFIX,
  definedTermFromBookmarkName,
  definedTermWords,
  type DocumentModelWire,
} from '@obiter/contracts'

import { documentStory } from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'

export type Mark = {
  id: string
  words: string[]
  paragraphId: string
  pending: boolean
  drifted: boolean
}

const BOOKMARK_START = /<w:bookmarkStart\b[^>]*>/g
const BOOKMARK_END = /<w:bookmarkEnd\b[^>]*>/g
const BOOKMARK_ID = /\bw:id="(\d+)"/u
const BOOKMARK_NAME = /\bw:name="([^"]*)"/u
const WORD = /[\p{L}\p{N}]+/gu

export function sameTerm(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((w, i) => w === right[i])
}

export function wordTokens(text: string) {
  return text.toLowerCase().match(WORD) ?? []
}

export function countOccurrences(
  tokens: readonly string[],
  term: readonly string[],
) {
  let count = 0
  for (let index = 0; index + term.length <= tokens.length; index += 1) {
    if (term.every((word, part) => tokens[index + part] === word)) count += 1
  }
  return count
}

export function collectMarks(
  model: DocumentModelWire,
  structures: readonly StructuralDraft[],
  gone: ReadonlySet<string>,
  textOf: (paragraphId: string) => string | undefined,
) {
  const marks: Mark[] = []
  const definedStarted = new Map<string, string>()
  const ended = new Map<string, string>()
  const malformed: Array<{ paragraphId: string; name: string }> = []
  for (const paragraph of documentStory(model)?.paragraphs ?? []) {
    if (gone.has(paragraph.id)) continue
    const fragments = [
      ...paragraph.preservedXmlFragments,
      ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    ]
    for (const fragment of fragments) {
      for (const match of fragment.matchAll(BOOKMARK_START)) {
        const element = match[0]
        const name = BOOKMARK_NAME.exec(element)?.[1]
        if (name === undefined) continue
        const term = definedTermFromBookmarkName(name)
        if (term) {
          const id = BOOKMARK_ID.exec(element)?.[1]
          if (id !== undefined) definedStarted.set(id, paragraph.id)
          marks.push({
            id: `bm-${name}`,
            words: term.words,
            paragraphId: paragraph.id,
            pending: false,
            drifted: false,
          })
        } else if (name.startsWith(DEFINED_TERM_NAME_PREFIX)) {
          malformed.push({ paragraphId: paragraph.id, name })
        }
      }
      for (const match of fragment.matchAll(BOOKMARK_END)) {
        const id = BOOKMARK_ID.exec(match[0])?.[1]
        if (id !== undefined) ended.set(id, paragraph.id)
      }
    }
  }
  for (const structure of structures) {
    if (structure.kind !== 'defined-term' || gone.has(structure.paragraphId)) {
      continue
    }
    const words = definedTermWords(structure.marked)
    if (words) {
      const covered = textOf(structure.paragraphId)?.slice(
        structure.from,
        structure.to,
      )
      marks.push({
        id: structure.id,
        words,
        paragraphId: structure.paragraphId,
        pending: true,
        drifted: covered !== undefined && covered !== structure.marked,
      })
    }
  }
  const unpaired: Array<{ paragraphId: string; id: string }> = []
  for (const [id, paragraphId] of definedStarted) {
    if (!ended.has(id)) unpaired.push({ paragraphId, id })
  }
  return { marks, unpaired, malformed }
}
