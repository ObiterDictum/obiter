import {
  neutralCitationPatternSource,
  parseLegislationActPath,
  parseLegislationProvisionPath,
  type DocumentModelWire,
} from '@obiter/contracts'

export type DraftSpan = {
  paragraphId: string
  start: number
  end: number
  rawText: string
}

export type ExtractedCitation = DraftSpan & { id: string }

export type ExtractedQuote = DraftSpan & {
  attributedCitationId: string | null
}

export const maxVerificationCandidates = 500

const NEUTRAL_CITATION = new RegExp(neutralCitationPatternSource, 'g')
const LEGISLATION_PATH = /\/ln\/ukpga\/[0-9]{4}\/[0-9]+(?:\/[A-Za-z0-9._-]+)*/g
const CURLY_QUOTE = /\u201C([^\u201D]+)\u201D/g
const STRAIGHT_QUOTE = /"([^"]+)"/g

export class VerificationExtractionLimitError extends Error {
  constructor() {
    super('Verification extraction exceeded the candidate bound.')
    this.name = 'VerificationExtractionLimitError'
  }
}

function spanId(span: DraftSpan) {
  return `${span.paragraphId}:${span.start}:${span.end}`
}

function paragraphPlainText(
  paragraph: DocumentModelWire['stories'][number]['paragraphs'][number],
) {
  return paragraph.runs.map((run) => run.text).join('')
}

function documentParagraphs(model: DocumentModelWire) {
  const story = model.stories.find((item) => item.kind === 'document')
  if (!story) return []
  return story.paragraphs.map((paragraph) => ({
    id: paragraph.id,
    text: paragraphPlainText(paragraph),
  }))
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

function legislationSpan(rawText: string) {
  let candidate = rawText.replace(/\.+$/, '')
  while (candidate.length >= '/ln/ukpga/1801/1'.length) {
    if (
      parseLegislationProvisionPath(candidate) ||
      parseLegislationActPath(candidate)
    ) {
      return candidate
    }
    candidate = candidate.slice(0, -1)
  }
  return null
}

function extractCitations(paragraphId: string, text: string) {
  const citations: ExtractedCitation[] = []
  for (const match of collectMatches(text, NEUTRAL_CITATION)) {
    citations.push({ paragraphId, ...match, id: '' })
  }
  for (const match of collectMatches(text, LEGISLATION_PATH)) {
    const rawText = legislationSpan(match.rawText)
    if (!rawText) continue
    citations.push({
      paragraphId,
      start: match.start,
      end: match.start + rawText.length,
      rawText,
      id: '',
    })
  }
  const unique = new Map<string, ExtractedCitation>()
  for (const citation of citations) {
    const id = spanId(citation)
    unique.set(id, { ...citation, id })
  }
  return [...unique.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}

function extractQuotes(paragraphId: string, text: string) {
  const quotes: DraftSpan[] = []
  for (const pattern of [CURLY_QUOTE, STRAIGHT_QUOTE]) {
    for (const match of collectQuoted(text, pattern)) {
      quotes.push({ paragraphId, ...match })
    }
  }
  const unique = new Map<string, DraftSpan>()
  for (const quote of quotes) unique.set(spanId(quote), quote)
  return [...unique.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}

function attributeQuote(quote: DraftSpan, citations: ExtractedCitation[]) {
  const following = citations.filter((citation) => citation.start >= quote.end)
  if (following.length > 0) return following[0]!.id
  const preceding = citations.filter((citation) => citation.end <= quote.start)
  if (preceding.length > 0) return preceding[preceding.length - 1]!.id
  return null
}

export function extractVerificationCandidates(model: DocumentModelWire) {
  const citations: ExtractedCitation[] = []
  const quotes: ExtractedQuote[] = []
  for (const paragraph of documentParagraphs(model)) {
    const paragraphCitations = extractCitations(paragraph.id, paragraph.text)
    citations.push(...paragraphCitations)
    for (const quote of extractQuotes(paragraph.id, paragraph.text)) {
      quotes.push({
        ...quote,
        attributedCitationId: attributeQuote(quote, paragraphCitations),
      })
    }
  }
  if (
    citations.length > maxVerificationCandidates ||
    quotes.length > maxVerificationCandidates
  ) {
    throw new VerificationExtractionLimitError()
  }
  return { citations, quotes }
}
