import { XMLParser } from 'fast-xml-parser'
import type { LegalParagraph } from '@obiter/legal-schema'
import { decodeHtml } from './document-utils'

/**
 * Parses Find Case Law's LegalDocML (Akoma Ntoso) `data.xml` into judgment
 * paragraphs.
 *
 * The HTML path numbers paragraphs by their position among extracted blocks, so
 * a pinpoint citation resolves to the nth block rather than to the paragraph the
 * court numbered. It also has no reliable way to tell judgment prose from the
 * cover sheet. LegalDocML marks both explicitly: `<header>` holds the front
 * matter, and each `<paragraph>` carries the court's own `<num>`.
 */

/**
 * Identity recorded per document in a snapshot manifest. Bump `version` when a
 * change alters the text this produces, so a corpus built before and after can
 * be told apart without re-deriving it.
 */
export const legalDocMlParser = { id: 'legaldocml', version: 1 } as const
export const htmlParser = { id: 'html', version: 1 } as const
export type ParserIdentity = { id: string; version: number }

type OrderedNode = Record<string, unknown>

/** Where fast-xml-parser puts attributes when preserving document order. */
const attributeKey = ':@'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  preserveOrder: true,
  textNodeName: '#text',
  trimValues: false,
  // Judgment text is text. Left on, this coerces a paragraph reading "7." into
  // the number 7, and anything that looks numeric loses its original form.
  parseTagValue: false,
  parseAttributeValue: false,
  // Judgment prose is full of entities; losing them would corrupt quotations.
  processEntities: true,
})

function childrenOf(node: OrderedNode, tag: string): OrderedNode[] {
  const value = node[tag]
  return Array.isArray(value) ? (value as OrderedNode[]) : []
}

/** Children of the first direct `tag` child, without descending further. */
function directChild(nodes: OrderedNode[], tag: string): OrderedNode[] {
  for (const node of nodes) {
    if (tag in node) return childrenOf(node, tag)
  }

  return []
}

function findFirst(nodes: OrderedNode[], tag: string): OrderedNode[] | null {
  for (const node of nodes) {
    if (tag in node) return childrenOf(node, tag)

    for (const key of Object.keys(node)) {
      if (key.startsWith('@') || key === '#text') continue
      const found = findFirst(childrenOf(node, key), tag)
      if (found) return found
    }
  }

  return null
}

/**
 * Concatenates text, skipping subtrees whose tag is in `skip`. `<num>` is
 * skipped for paragraph bodies: it holds the paragraph's own number, which
 * belongs in `paragraphNumber` rather than repeated at the start of the text.
 */
function collectText(nodes: OrderedNode[], skip: ReadonlySet<string>): string {
  let text = ''

  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === attributeKey) continue
      if (key === '#text') {
        text += String(node[key] ?? '')
        continue
      }
      if (key.startsWith('@') || skip.has(key)) continue
      text += ` ${collectText(childrenOf(node, key), skip)}`
    }
  }

  return text
}

function normalise(text: string) {
  // The XML carries numeric character references for quotes, dashes and the
  // like; indexed text needs the characters themselves.
  return decodeHtml(text).replace(/\s+/g, ' ').trim()
}

const skipNum: ReadonlySet<string> = new Set(['num'])
const skipNothing: ReadonlySet<string> = new Set()

/**
 * The court's own paragraph number, preferred over position so that a pinpoint
 * citation resolves to what a reader would cite. `<num>` may carry decoration
 * such as a section mark or a trailing stop; a nested list item may number
 * itself `(a)` or `ii)`, which is not a paragraph number and falls back to the
 * element id or to position.
 */
function paragraphNumberFrom(
  numText: string,
  eId: string | undefined,
  position: number,
): number {
  const fromNum = numText.match(/\d+/)?.[0]
  if (fromNum && Number(fromNum) > 0) return Number(fromNum)

  const fromEid = eId?.match(/(\d+)/)?.[1]
  if (fromEid && Number(fromEid) > 0) return Number(fromEid)

  return position
}

/**
 * Returns null when the document has no LegalDocML judgment body, which is the
 * signal to fall back to HTML rather than to store an empty judgment.
 */
export function parseLegalDocMlParagraphs(
  xml: string,
  documentId: string,
): LegalParagraph[] | null {
  let parsed: OrderedNode[]
  try {
    parsed = parser.parse(xml) as OrderedNode[]
  } catch {
    return null
  }

  const body = findFirst(parsed, 'judgmentBody')
  if (!body) return null

  const decision = findFirst(body, 'decision') ?? body
  const paragraphs: LegalParagraph[] = []

  /** Unnumbered text belongs to the paragraph that introduced it. */
  function appendToPrevious(text: string) {
    const previous = paragraphs.at(-1)
    if (previous) previous.text = `${previous.text} ${text}`
  }

  /**
   * Walks the body in document order.
   *
   * Judgments are structured two ways. Most list paragraphs directly under
   * `<decision>`. Others group them under `<level>` elements with headings, and
   * a traversal that only looked at direct children found no paragraphs at all
   * in those and fell back to HTML — which is the parse this exists to avoid.
   */
  function visit(nodes: OrderedNode[]) {
    for (const node of nodes) {
      const tag = Object.keys(node).find(
        (key) => key !== attributeKey && key !== '#text',
      )
      if (!tag) continue

      const children = childrenOf(node, tag)

      if (tag === 'paragraph') {
        // The paragraph's own `<num>`, not a nested list item's. A recursive
        // search would find `(a)` or `ii)` inside a subparagraph and number the
        // paragraph from that.
        const numText = normalise(
          collectText(directChild(children, 'num'), skipNothing),
        )
        const text = normalise(collectText(children, skipNum))
        if (!text) continue

        const attributes = (node[attributeKey] ?? {}) as Record<string, string>
        paragraphs.push({
          id: `${documentId}-p${paragraphs.length + 1}`,
          documentId,
          paragraphNumber: paragraphNumberFrom(
            numText,
            attributes['@eId'],
            paragraphs.length + 1,
          ),
          text,
        })
        continue
      }

      // A grouping element: its heading is unnumbered text, and the paragraphs
      // inside it are paragraphs of the judgment like any other.
      if (tag === 'level') {
        visit(children)
        continue
      }

      // Headings and block-quoted authority between paragraphs. Content before
      // the first paragraph is the cover matter — judge name, "JUDGMENT" — and
      // is dropped, because there is nothing for it to belong to.
      const text = normalise(collectText(children, skipNothing))
      if (text) appendToPrevious(text)
    }
  }

  visit(decision)

  return paragraphs.length > 0 ? paragraphs : null
}

/**
 * Metadata the judgment states about itself. The Atom entry already carries
 * these, so this exists to fill gaps rather than to override the feed.
 */
export function extractLegalDocMlMetadata(xml: string): {
  title: string | null
  dateDecided: string | null
  neutralCitation: string | null
} {
  let parsed: OrderedNode[]
  try {
    parsed = parser.parse(xml) as OrderedNode[]
  } catch {
    return { title: null, dateDecided: null, neutralCitation: null }
  }

  const work = findFirst(parsed, 'FRBRWork')
  const attributesOf = (nodes: OrderedNode[] | null, tag: string) => {
    if (!nodes) return undefined
    for (const node of nodes) {
      if (tag in node)
        return (node[attributeKey] ?? {}) as Record<string, string>
    }
    return undefined
  }

  const citationNodes = findFirst(parsed, 'neutralCitation')

  return {
    title: attributesOf(work, 'FRBRname')?.['@value'] ?? null,
    dateDecided:
      attributesOf(work, 'FRBRdate')?.['@date']?.slice(0, 10) ?? null,
    neutralCitation: citationNodes
      ? normalise(collectText(citationNodes, skipNothing)) || null
      : null,
  }
}
