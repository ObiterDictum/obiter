import {
  classifyNeutralCitationCandidate,
  neutralCitationPatternSource,
  parseLegislationActPath,
  parseLegislationProvisionPath,
  type DocumentModelWire,
  type DocumentParagraphWire,
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

const NEUTRAL_CITATION = new RegExp(neutralCitationPatternSource, 'g')

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

export type AuthorityInputKind =
  'neutral' | 'unsupported_court' | 'legislation' | 'invalid'

export function classifyAuthorityInput(value: string): AuthorityInputKind {
  const trimmed = value.trim()
  if (!trimmed) return 'invalid'
  const kind = classifyNeutralCitationCandidate(trimmed)
  if (kind === 'citation') return 'neutral'
  if (kind === 'unsupported_court') return 'unsupported_court'
  if (
    trimmed.startsWith('/ln/') &&
    (parseLegislationActPath(trimmed) !== null ||
      parseLegislationProvisionPath(trimmed) !== null)
  ) {
    return 'legislation'
  }
  return 'invalid'
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
