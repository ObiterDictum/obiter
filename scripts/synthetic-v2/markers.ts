import { spanCategories, type SyntheticSpan } from './types'

const openPrefix = '<pii category="'
const openSuffix = '">'
const close = '</pii>'
const labels = new Set<string>(spanCategories)

export class MarkerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarkerValidationError'
  }
}

/** Converts XML PII tags into plain text and exact UTF-16 offsets. */
export function stripMarkers(markedText: string): {
  text: string
  spans: SyntheticSpan[]
} {
  let sourceIndex = 0
  let text = ''
  const spans: SyntheticSpan[] = []

  while (sourceIndex < markedText.length) {
    const nextOpen = markedText.indexOf(openPrefix, sourceIndex)
    if (nextOpen === -1) {
      const tail = markedText.slice(sourceIndex)
      if (tail.includes(close))
        throw new MarkerValidationError('Dangling closing tag')
      text += tail
      break
    }

    const before = markedText.slice(sourceIndex, nextOpen)
    if (before.includes(close))
      throw new MarkerValidationError('Dangling closing tag')
    text += before

    const categoryEnd = markedText.indexOf(
      openSuffix,
      nextOpen + openPrefix.length,
    )
    if (categoryEnd === -1)
      throw new MarkerValidationError('Unterminated opening tag')
    const category = markedText.slice(nextOpen + openPrefix.length, categoryEnd)
    if (!labels.has(category))
      throw new MarkerValidationError(`Unknown marker label: ${category}`)

    const valueStart = categoryEnd + openSuffix.length
    const closeIndex = markedText.indexOf(close, valueStart)
    if (closeIndex === -1)
      throw new MarkerValidationError('Unterminated span tag')
    const value = markedText.slice(valueStart, closeIndex)
    if (value.length === 0) throw new MarkerValidationError('Empty marked span')
    if (value.includes(openPrefix) || value.includes(close))
      throw new MarkerValidationError('Nested marker')

    const start = text.length
    text += value
    const end = text.length
    spans.push({
      category: category as SyntheticSpan['category'],
      start,
      end,
      text: value,
    })
    sourceIndex = closeIndex + close.length
  }

  if (text.includes(openPrefix) || text.includes(close))
    throw new MarkerValidationError('Unresolved marker')
  validateSpans(text, spans)
  return { text, spans }
}

/** Deterministically render validated span offsets as XML for downstream exports. */
export function renderMarkers(text: string, spans: SyntheticSpan[]) {
  validateSpans(text, spans)
  let cursor = 0
  let marked = ''
  for (const span of [...spans].sort(
    (left, right) => left.start - right.start,
  )) {
    marked += escapeXml(text.slice(cursor, span.start))
    marked += `<pii category="${span.category}">${escapeXml(span.text)}</pii>`
    cursor = span.end
  }
  return marked + escapeXml(text.slice(cursor))
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function validateSpans(text: string, spans: SyntheticSpan[]) {
  let previousEnd = 0
  for (const span of [...spans].sort(
    (left, right) => left.start - right.start,
  )) {
    if (!labels.has(span.category))
      throw new MarkerValidationError(`Unknown span label: ${span.category}`)
    if (
      span.start < 0 ||
      span.end <= span.start ||
      span.end > text.length ||
      text.slice(span.start, span.end) !== span.text
    )
      throw new MarkerValidationError(
        `Offset round-trip failed for ${span.category}`,
      )
    if (span.start < previousEnd)
      throw new MarkerValidationError('Overlapping or nested spans')
    previousEnd = span.end
  }
}
