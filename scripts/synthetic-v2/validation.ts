import { createHash } from 'node:crypto'
import { stripMarkers } from './markers'
import type { DocumentSpec, SyntheticDocument } from './types'

export function normalizeGenerated(
  spec: DocumentSpec,
  generated: { text: string; generator: string },
): SyntheticDocument {
  const { text, spans } = stripMarkers(generated.text)
  const emitted = new Set(spans.map((span) => span.category))
  for (const category of spec.requiredCategories) {
    if (!emitted.has(category))
      throw new Error(`${spec.id} omitted required category ${category}`)
  }
  return {
    id: spec.id,
    text,
    spans,
    generator: generated.generator,
    specCell: `${spec.docType}|${spec.register}|${spec.difficulty}`,
    matrixCells: spec.matrixCells,
    contentHash: contentHash(text),
  }
}

export function contentHash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

function shingles(text: string, size = 5) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return new Set(
    Array.from({ length: Math.max(0, words.length - size + 1) }, (_, index) =>
      words.slice(index, index + size).join(' '),
    ),
  )
}

export function nearDuplicatePairs(
  documents: SyntheticDocument[],
  threshold = 0.82,
) {
  const pairs: Array<{ left: string; right: string; similarity: number }> = []
  const documentShingles = documents.map((document) => shingles(document.text))
  for (let left = 0; left < documents.length; left++) {
    for (let right = 0; right < left; right++) {
      const leftSet = documentShingles[left]!
      const rightSet = documentShingles[right]!
      const intersection = [...leftSet].filter((shingle) =>
        rightSet.has(shingle),
      ).length
      const union = leftSet.size + rightSet.size - intersection
      const similarity = union === 0 ? 1 : intersection / union
      if (similarity >= threshold)
        pairs.push({
          left: documents[left]!.id,
          right: documents[right]!.id,
          similarity: Number(similarity.toFixed(4)),
        })
    }
  }
  return pairs
}
