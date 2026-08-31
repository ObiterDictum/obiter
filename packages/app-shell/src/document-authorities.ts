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

export type AuthorityHit = {
  paragraphId: string
  start: number
  end: number
  citation: string
}

const NEUTRAL_CITATION =
  /\[(?:18|19|20)\d{2}]\s+(?:UKSC|UKHL|UKPC|EWCA(?:\s+Civ|\s+Crim)?|EWHC(?:\s+\([A-Za-z]+\))?|EWFC|EWCOP|UKUT(?:\s+\([A-Za-z]+\))?|UKFTT(?:\s+\([A-Za-z]+\))?|CSIH|CSOH|NICA|NIQB)\s+\d+(?:\s+\([A-Za-z]+\))?/g

export function extractAuthorities(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: readonly string[],
  extraRuns: ExtraRuns = {},
): AuthorityHit[] {
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const paragraphsById = new Map(
    documentStory(model)?.paragraphs.map((item) => [item.id, item]) ?? [],
  )
  const hits: AuthorityHit[] = []
  for (const id of flowParagraphIds(model, inserts, [...deletedParagraphIds])) {
    const insert = insertById.get(id)
    const paragraph = paragraphsById.get(id)
    const text = insert
      ? insertPlainText(insert)
      : paragraph
        ? paragraphTextWithExtra(paragraph, drafts, extraRuns)
        : ''
    NEUTRAL_CITATION.lastIndex = 0
    let match = NEUTRAL_CITATION.exec(text)
    while (match) {
      hits.push({
        paragraphId: id,
        start: match.index,
        end: match.index + match[0].length,
        citation: match[0],
      })
      match = NEUTRAL_CITATION.exec(text)
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
