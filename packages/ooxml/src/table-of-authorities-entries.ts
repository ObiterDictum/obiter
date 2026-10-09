import { neutralCitationPatternSource } from '@obiter/contracts'
import type { DocumentParagraphWire } from '@obiter/contracts'

/**
 * One citation occurrence in a body paragraph: the citing paragraph and the
 * effective-text offset just past the citation — where the hidden `TA` mark
 * is spliced.
 */
export type AuthorityOccurrence = {
  paragraphId: string
  end: number
  citation: string
}

/**
 * One `TOA` entry: a distinct citation and the paragraphs that cite it, in
 * document order — each gets a `_ToA` bookmark the entry's `PAGEREF` fields
 * resolve. Entries are sorted by citation text, matching the order a
 * regenerated table lists them.
 */
export type TableOfAuthoritiesEntry = {
  citation: string
  paragraphIds: string[]
}

/**
 * What a `TOA` field captures: every citing occurrence for the mark pass,
 * and the distinct-citation entries the generated paragraphs list.
 */
export type TableOfAuthorities = {
  occurrences: AuthorityOccurrence[]
  entries: TableOfAuthoritiesEntry[]
}

// The shared grammar `@obiter/contracts` owns, so the marks the writer
// splices name the same citations Verify resolves and the authorities list
// extracts. Compiled once at module load, not inside the scan loop.
const NEUTRAL_CITATION = new RegExp(neutralCitationPatternSource, 'g')
// Generated field-result paragraphs hold captured text, not authored text:
// a citation inside a table-of-authorities entry or a table-of-contents
// entry is a copy the field wrote, and marking it would put a `TA` mark
// inside the result a regenerated field replaces.
const GENERATED_RESULT_STYLE = /^(TOAHeading|TableofAuthorities|TOC\d+)$/u

/**
 * Whether a paragraph style names a generated field's result — the same
 * test the collector applies, exported so the ribbon's availability reads
 * the same exclusions the writer's mark pass does.
 */
export function isGeneratedFieldResultStyle(
  styleId: string | undefined,
): boolean {
  return GENERATED_RESULT_STYLE.test(styleId ?? '')
}

const wireText = (paragraph: DocumentParagraphWire) =>
  paragraph.runs.map((run) => run.text).join('')

/**
 * The citations a `TOA` field captures over `paragraphs`, in paragraph
 * order: every neutral-citation occurrence, and the distinct-citation entry
 * list grouping them. `textOf` supplies the text a caller reads — stored
 * wire text for the writer, effective text for the pending fold — so the
 * marks land at the offsets the splice receives and the entries name the
 * words the user sees. Paragraphs styled as a generated field's result are
 * skipped: their citation text is captured output, not a citing instance.
 */
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
