import type { RedactionSpan } from './types'

export interface TextChunk {
  text: string
  startOffset: number
}

export interface ChunkedSpans {
  spans: RedactionSpan[]
  chunkOffset: number
}

export function chunkText(text: string, maxTokens = 400): TextChunk[] {
  if (text.length === 0) return []
  const matches = [...text.matchAll(/\S+|\s+/g)]
  const tokenMatches = matches.filter((match) => /\S/.test(match[0]))
  if (tokenMatches.length <= maxTokens) return [{ text, startOffset: 0 }]

  const chunks: TextChunk[] = []
  const overlap = Math.min(50, Math.floor(maxTokens / 4))
  for (let tokenIndex = 0; tokenIndex < tokenMatches.length; tokenIndex += Math.max(1, maxTokens - overlap)) {
    const first = tokenMatches[tokenIndex]
    const last = tokenMatches[Math.min(tokenIndex + maxTokens, tokenMatches.length) - 1]
    if (!first || !last?.index) continue
    const startOffset = first.index
    const endOffset = last.index + last[0].length
    chunks.push({ text: text.slice(startOffset, endOffset), startOffset })
    if (tokenIndex + maxTokens >= tokenMatches.length) break
  }
  return chunks
}

export function reassembleSpans(chunkedSpans: ChunkedSpans[]): RedactionSpan[] {
  const seen = new Set<string>()
  const spans: RedactionSpan[] = []
  for (const chunk of chunkedSpans) {
    for (const span of chunk.spans) {
      const adjusted = { ...span, start: span.start + chunk.chunkOffset, end: span.end + chunk.chunkOffset }
      const key = `${adjusted.start}:${adjusted.end}:${adjusted.category}:${adjusted.text}`
      if (!seen.has(key)) {
        seen.add(key)
        spans.push(adjusted)
      }
    }
  }
  return spans.sort((left, right) => left.start - right.start || left.end - right.end)
}
