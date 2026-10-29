import type { Decisions, RedactionSpan } from './types'

export class RedactionSpanIntegrityError extends Error {
  readonly spanId: string

  constructor(spanId: string) {
    super(`The stored text for span ${spanId} no longer matches the document.`)
    this.name = 'RedactionSpanIntegrityError'
    this.spanId = spanId
  }
}

export interface TokenMap {
  [token: string]: string
}

export interface RedactionRegion {
  start: number
  end: number
  spanIds: string[]
}

export interface RedactionRange {
  start: number
  end: number
  spanId: string
}

const REGION_GAP = /^[ \t]*$/

export function affectsOutput(decision: Decisions[string] | undefined) {
  return (
    decision?.decision === 'accept' ||
    decision?.decision === 'override_redact' ||
    decision?.decision === 'pseudonymise'
  )
}

export function coalesceRanges(
  text: string,
  ranges: readonly RedactionRange[],
): RedactionRegion[] {
  const ordered = [...ranges].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )
  const regions: RedactionRegion[] = []
  for (const range of ordered) {
    const current = regions.at(-1)
    const joins =
      current !== undefined &&
      (range.start <= current.end ||
        REGION_GAP.test(text.slice(current.end, range.start)))
    if (!current || !joins) {
      regions.push({
        start: range.start,
        end: range.end,
        spanIds: [range.spanId],
      })
      continue
    }
    current.end = Math.max(current.end, range.end)
    if (!current.spanIds.includes(range.spanId))
      current.spanIds.push(range.spanId)
  }
  return regions
}

export function coalesceRedactionRegions(
  text: string,
  spans: RedactionSpan[],
  decisions: Decisions,
): RedactionRegion[] {
  const affected = spans.filter((span) => affectsOutput(decisions[span.id]))
  for (const span of affected) {
    if (text.slice(span.start, span.end) !== span.text) {
      throw new RedactionSpanIntegrityError(span.id)
    }
  }
  return coalesceRanges(
    text,
    affected.map((span) => ({
      start: span.start,
      end: span.end,
      spanId: span.id,
    })),
  )
}

function outputSpans(
  text: string,
  spans: RedactionSpan[],
  decisions: Decisions,
): RedactionSpan[] {
  const affected = spans.filter((span) => affectsOutput(decisions[span.id]))

  for (const span of affected) {
    if (text.slice(span.start, span.end) !== span.text) {
      throw new RedactionSpanIntegrityError(span.id)
    }
  }

  return affected
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((span, index, ordered) => {
      const previous = ordered[index - 1]
      return !previous || previous.end <= span.start
    })
}

interface Replacement {
  start: number
  end: number
  replacement: string
}

function replace(text: string, replacements: Replacement[]) {
  return replacements
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce(
      (result, replacement) =>
        `${result.slice(0, replacement.start)}${replacement.replacement}${result.slice(replacement.end)}`,
      text,
    )
}

export function applyRedacted(
  text: string,
  spans: RedactionSpan[],
  decisions: Decisions,
): string {
  return replace(
    text,
    coalesceRedactionRegions(text, spans, decisions).map((region) => ({
      start: region.start,
      end: region.end,
      replacement: '[REDACTED]',
    })),
  )
}

export function createTokenMap(
  text: string,
  spans: RedactionSpan[],
  decisions: Decisions,
): TokenMap {
  const tokens: TokenMap = {}
  const entityTokens = new Map<string, string>()
  const nextByCategory = new Map<string, number>()

  for (const span of outputSpans(text, spans, decisions)) {
    const entityKey = `${span.category}:${span.text}`
    let token = entityTokens.get(entityKey)
    if (!token) {
      const category = span.category.toUpperCase()
      const next = (nextByCategory.get(category) ?? 0) + 1
      nextByCategory.set(category, next)
      token = `${category}_${next}`
      entityTokens.set(entityKey, token)
      tokens[token] = span.text
    }
  }

  return tokens
}

export function applyPseudonymised(
  text: string,
  spans: RedactionSpan[],
  decisions: Decisions,
): string {
  const tokenMap = createTokenMap(text, spans, decisions)
  const tokensByEntity = new Map(
    Object.entries(tokenMap).map(([token, value]) => [
      `${token.slice(0, token.lastIndexOf('_'))?.toLowerCase()}:${value}`,
      token,
    ]),
  )

  return replace(
    text,
    outputSpans(text, spans, decisions).map((span) => {
      const token = tokensByEntity.get(`${span.category}:${span.text}`)
      if (!token)
        throw new Error(`Missing pseudonym token for span ${span.id}.`)
      return { start: span.start, end: span.end, replacement: `[${token}]` }
    }),
  )
}
