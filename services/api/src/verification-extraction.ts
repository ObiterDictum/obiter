import {
  neutralCitationPatternSource,
  parseLegislationActPath,
  parseLegislationProvisionPath,
  type DocumentModelWire,
  type DocumentStoryKind,
} from '@obiter/contracts'

export type DraftSpan = {
  /** The paragraph id inside its story. Only unique together with the story. */
  paragraphId: string
  storyKind: DocumentStoryKind
  storyPartName: string
  start: number
  end: number
  rawText: string
}

/** A stable, story-scoped paragraph key. Used for finding identity and quote
 * grouping so two stories that reuse `p1` cannot collide. The unit separator
 * cannot appear in an OOXML part name or paragraph id. */
export type StoryScopedSpan = DraftSpan & { locationParagraphId: string }

export type ExtractedCitation = StoryScopedSpan & { id: string }

export type QuoteAttribution = 'attributed' | 'ambiguous' | 'none'

export type ExtractedQuote = StoryScopedSpan & {
  id: string
  attributedCitationId: string | null
  attribution: QuoteAttribution
}

export type CheckedStory = {
  kind: DocumentStoryKind
  partName: string
  paragraphCount: number
}

export type ExtractedCandidates = {
  citations: ExtractedCitation[]
  quotes: ExtractedQuote[]
  /** The stories actually traversed, in traversal order. */
  checkedStories: CheckedStory[]
  /** Story kinds present in the model but deliberately not traversed. */
  skippedStoryKinds: DocumentStoryKind[]
}

export const maxVerificationCandidates = 500

/**
 * The stories V5 checks. Legal drafting puts citations in footnotes and
 * endnotes as often as in the body, so all three are in scope. Headers,
 * footers and comments are deliberately out of scope until a product decision
 * says otherwise: enabling them silently would start verifying boilerplate and
 * reviewer chatter as if it were the draft. `skippedStoryKinds` records what the
 * model held, so a completed run can disclose its coverage rather than imply
 * the whole document was checked.
 */
export const verificationStoryKinds: DocumentStoryKind[] = [
  'document',
  'footnotes',
  'endnotes',
]

const NEUTRAL_CITATION = new RegExp(neutralCitationPatternSource, 'g')
/**
 * One lexically bounded `/ln/ukpga/...` token: every non-whitespace character
 * after the prefix, so a malformed suffix (`42x`, `%20`, `?q=1#f`) stays inside
 * the token and the whole token must parse under the canonical parser. There is
 * deliberately no shrink-until-a-prefix-parses loop: a candidate that does not
 * parse verbatim reaches V3 as-is and comes back unresolved, never rewritten
 * into a different authority.
 */
const LEGISLATION_PATH = /\/ln\/ukpga\/\S+/g
const CURLY_QUOTE = /\u201C([^\u201D]+)\u201D/g
const STRAIGHT_QUOTE = /"([^"]+)"/g
const STORY_SEPARATOR = '\u001f'

/**
 * Sentence punctuation a solicitor writes immediately after a path. At most one
 * is removed, and only when the remainder parses; repeated punctuation is left
 * in the token and so fails to parse rather than collapsing to a valid
 * identity.
 */
const TRAILING_PROSE_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  ')',
  ']',
  '}',
  '"',
  "'",
  '\u201C',
  '\u201D',
  '\u2018',
  '\u2019',
])

export class VerificationExtractionLimitError extends Error {
  constructor() {
    super('Verification extraction exceeded the candidate bound.')
    this.name = 'VerificationExtractionLimitError'
  }
}

function scopedParagraphId(
  kind: DocumentStoryKind,
  partName: string,
  paragraphId: string,
) {
  return [kind, partName, paragraphId].join(STORY_SEPARATOR)
}

function spanId(span: StoryScopedSpan) {
  return `${span.locationParagraphId}:${span.start}:${span.end}`
}

function paragraphPlainText(
  paragraph: DocumentModelWire['stories'][number]['paragraphs'][number],
) {
  return paragraph.runs.map((run) => run.text).join('')
}

type StoryParagraph = {
  paragraphId: string
  storyKind: DocumentStoryKind
  storyPartName: string
  text: string
}

/** Every in-scope story, in a fixed traversal order, so reruns are stable
 * regardless of how the model ordered its stories. */
function storyParagraphs(model: DocumentModelWire) {
  const paragraphs: StoryParagraph[] = []
  const checkedStories: CheckedStory[] = []
  for (const kind of verificationStoryKinds) {
    const stories = model.stories
      .filter((story) => story.kind === kind)
      .sort((left, right) => left.partName.localeCompare(right.partName))
    for (const story of stories) {
      checkedStories.push({
        kind,
        partName: story.partName,
        paragraphCount: story.paragraphs.length,
      })
      for (const paragraph of story.paragraphs) {
        paragraphs.push({
          paragraphId: paragraph.id,
          storyKind: kind,
          storyPartName: story.partName,
          text: paragraphPlainText(paragraph),
        })
      }
    }
  }
  return { paragraphs, checkedStories }
}

function collectMatches(text: string, pattern: RegExp) {
  pattern.lastIndex = 0
  const matches: { start: number; end: number; rawText: string }[] = []
  let match = pattern.exec(text)
  while (match) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      rawText: match[0],
    })
    match = pattern.exec(text)
  }
  return matches
}

function collectQuoted(text: string, pattern: RegExp) {
  pattern.lastIndex = 0
  const matches: { start: number; end: number; rawText: string }[] = []
  let match = pattern.exec(text)
  while (match) {
    const inner = match[1] ?? ''
    if (inner.trim().length === 0) {
      match = pattern.exec(text)
      continue
    }
    const start = match.index + (match[0].length - inner.length - 1)
    matches.push({ start, end: start + inner.length, rawText: inner })
    match = pattern.exec(text)
  }
  return matches
}

/** The path a `/ln/ukpga/...` token names, once at most one documented trailing
 * prose punctuation character is removed. The token itself is never rewritten
 * to a different identity: either the whole path parses or the token is
 * reported as written. */
export function legislationPathToken(token: string) {
  const last = token.at(-1)
  if (last === undefined || !TRAILING_PROSE_PUNCTUATION.has(last)) return token
  const previous = token.at(-2)
  // Repeated punctuation is not prose punctuation; leaving it in keeps the
  // token unparseable instead of collapsing it to a valid prefix.
  if (previous !== undefined && TRAILING_PROSE_PUNCTUATION.has(previous)) {
    return token
  }
  const trimmed = token.slice(0, -1)
  return parseLegislationProvisionPath(trimmed) ||
    parseLegislationActPath(trimmed)
    ? trimmed
    : token
}

function citationSpan(
  paragraph: StoryParagraph,
  match: { start: number; end: number; rawText: string },
  rawText: string,
): ExtractedCitation {
  const locationParagraphId = scopedParagraphId(
    paragraph.storyKind,
    paragraph.storyPartName,
    paragraph.paragraphId,
  )
  const span: StoryScopedSpan = {
    paragraphId: paragraph.paragraphId,
    storyKind: paragraph.storyKind,
    storyPartName: paragraph.storyPartName,
    start: match.start,
    end: match.start + rawText.length,
    rawText,
    locationParagraphId,
  }
  return { ...span, id: spanId(span) }
}

function extractCitations(paragraph: StoryParagraph) {
  const citations: ExtractedCitation[] = []
  for (const match of collectMatches(paragraph.text, NEUTRAL_CITATION)) {
    citations.push(citationSpan(paragraph, match, match.rawText))
  }
  for (const match of collectMatches(paragraph.text, LEGISLATION_PATH)) {
    citations.push(
      citationSpan(paragraph, match, legislationPathToken(match.rawText)),
    )
  }
  const unique = new Map<string, ExtractedCitation>()
  for (const citation of citations) unique.set(citation.id, citation)
  return [...unique.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}

function extractQuotes(paragraph: StoryParagraph) {
  const locationParagraphId = scopedParagraphId(
    paragraph.storyKind,
    paragraph.storyPartName,
    paragraph.paragraphId,
  )
  const quotes: StoryScopedSpan[] = []
  for (const pattern of [CURLY_QUOTE, STRAIGHT_QUOTE]) {
    for (const match of collectQuoted(paragraph.text, pattern)) {
      quotes.push({
        paragraphId: paragraph.paragraphId,
        storyKind: paragraph.storyKind,
        storyPartName: paragraph.storyPartName,
        locationParagraphId,
        ...match,
      })
    }
  }
  const unique = new Map<string, StoryScopedSpan>()
  for (const quote of quotes) unique.set(spanId(quote), quote)
  return [...unique.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}

/**
 * A quotation is compared only when exactly one citation association is
 * defensible. A citation is a candidate when it lies wholly before or wholly
 * after the quotation; a candidate on both sides, several candidates on one
 * side, or one citation that several quotations would claim all yield
 * `ambiguous`, which the check turns into a review-required finding rather than
 * a clear or flagged result. Nothing is chosen by proximity or iteration order.
 */
function attributeQuotes(
  quotes: StoryScopedSpan[],
  citations: ExtractedCitation[],
): ExtractedQuote[] {
  const byParagraph = new Map<string, ExtractedCitation[]>()
  for (const citation of citations) {
    const list = byParagraph.get(citation.locationParagraphId) ?? []
    list.push(citation)
    byParagraph.set(citation.locationParagraphId, list)
  }
  const selected = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const quote of quotes) {
    const local = byParagraph.get(quote.locationParagraphId) ?? []
    const following = local.filter((citation) => citation.start >= quote.end)
    const preceding = local.filter((citation) => citation.end <= quote.start)
    if (following.length === 0 && preceding.length === 0) continue
    if (following.length > 0 && preceding.length > 0) {
      ambiguous.add(spanId(quote))
      continue
    }
    const side = following.length > 0 ? following : preceding
    if (side.length !== 1) {
      ambiguous.add(spanId(quote))
      continue
    }
    selected.set(spanId(quote), side[0]!.id)
  }
  const owners = new Map<string, string[]>()
  for (const [quoteId, citationId] of selected) {
    const list = owners.get(citationId) ?? []
    list.push(quoteId)
    owners.set(citationId, list)
  }
  for (const quoteIds of owners.values()) {
    if (quoteIds.length > 1)
      for (const quoteId of quoteIds) ambiguous.add(quoteId)
  }
  return quotes.map((quote) => {
    const id = spanId(quote)
    if (ambiguous.has(id)) {
      return {
        ...quote,
        id,
        attributedCitationId: null,
        attribution: 'ambiguous',
      }
    }
    const attributedCitationId = selected.get(id) ?? null
    return {
      ...quote,
      id,
      attributedCitationId,
      attribution: attributedCitationId ? 'attributed' : 'none',
    }
  })
}

export function extractVerificationCandidates(
  model: DocumentModelWire,
): ExtractedCandidates {
  const { paragraphs, checkedStories } = storyParagraphs(model)
  const citations: ExtractedCitation[] = []
  const quotes: StoryScopedSpan[] = []
  for (const paragraph of paragraphs) {
    citations.push(...extractCitations(paragraph))
    quotes.push(...extractQuotes(paragraph))
  }
  const attributedQuotes = attributeQuotes(quotes, citations)
  if (
    citations.length > maxVerificationCandidates ||
    attributedQuotes.length > maxVerificationCandidates
  ) {
    throw new VerificationExtractionLimitError()
  }
  const inScope = new Set(verificationStoryKinds)
  const skippedStoryKinds = [
    ...new Set(
      model.stories
        .map((story) => story.kind)
        .filter((kind) => !inScope.has(kind)),
    ),
  ].sort()
  return {
    citations,
    quotes: attributedQuotes,
    checkedStories,
    skippedStoryKinds,
  }
}
