import { neutralCitationPatternSource } from '@obiter/contracts'
import type { DocumentParagraphWire } from '@obiter/contracts'

export type AuthorityOccurrence = {
  paragraphId: string
  end: number
  citation: string
}

export type TableOfAuthoritiesEntry = {
  citation: string
  paragraphIds: string[]
}

export type TableOfAuthorities = {
  occurrences: AuthorityOccurrence[]
  entries: TableOfAuthoritiesEntry[]
}

const NEUTRAL_CITATION = new RegExp(neutralCitationPatternSource, 'g')
const GENERATED_RESULT_STYLE = /^(TOAHeading|TableofAuthorities|TOC\d+)$/u

export function isGeneratedFieldResultStyle(
  styleId: string | undefined,
): boolean {
  return GENERATED_RESULT_STYLE.test(styleId ?? '')
}

const wireText = (paragraph: DocumentParagraphWire) =>
  paragraph.runs.map((run) => run.text).join('')

export function tableOfAuthoritiesCitations(
  paragraphs: readonly DocumentParagraphWire[],
  textOf: (paragraph: DocumentParagraphWire) => string = wireText,
): TableOfAuthorities {
  const occurrences: AuthorityOccurrence[] = []
  const citingByCitation = new Map<string, string[]>()
  for (const paragraph of paragraphs) {
    if (GENERATED_RESULT_STYLE.test(paragraph.styleId ?? '')) continue
    const text = textOf(paragraph)
    NEUTRAL_CITATION.lastIndex = 0
    let match = NEUTRAL_CITATION.exec(text)
    while (match) {
      const end = match.index + match[0].length
      occurrences.push({ paragraphId: paragraph.id, end, citation: match[0] })
      const citing = citingByCitation.get(match[0]) ?? []
      if (!citing.includes(paragraph.id)) citing.push(paragraph.id)
      citingByCitation.set(match[0], citing)
      match = NEUTRAL_CITATION.exec(text)
    }
  }
  const entries = [...citingByCitation.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([citation, paragraphIds]) => ({ citation, paragraphIds }))
  return { occurrences, entries }
}
