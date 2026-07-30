import type { Decisions, RedactionSpan } from './types'

export class RedactionSpanIntegrityError extends Error {
  readonly spanId: string

  constructor(spanId: string) {
    super(`The stored text for span ${spanId} no longer matches the document.`)
    this.name = 'RedactionSpanIntegrityError'
    this.spanId = spanId
  }
}

export type TokenMap = Record<string, string>

type OutputSpan = RedactionSpan & { replacement: string }

export function affectsOutput(decision: Decisions[string] | undefined) {
  return (
    decision?.decision === 'accept' ||
    decision?.decision === 'override_redact' ||
    decision?.decision === 'pseudonymise'
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

function replace(text: string, spans: OutputSpan[]) {
  return spans
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce(
      (result, span) =>
        `${result.slice(0, span.start)}${span.replacement}${result.slice(span.end)}`,
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
    outputSpans(text, spans, decisions).map((span) => ({
      ...span,
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
      return { ...span, replacement: `[${token}]` }
    }),
  )
}
