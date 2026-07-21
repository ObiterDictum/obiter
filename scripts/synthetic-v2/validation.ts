import { createHash } from 'node:crypto'
import { canonicalJson } from './governance'
import { generationSpecIdentity } from './matrix'
import { stripMarkers, validateSpans } from './markers'
import type {
  DocumentSpec,
  HardNegativeAssertion,
  SyntheticDocument,
} from './types'

export type NearDuplicateMatch = {
  left: string
  right: string
  similarity: number
}

export type NearDuplicateSignature = {
  id: string
  textHash: string
  shingles: string[]
}

export function normalizeGenerated(
  spec: DocumentSpec,
  generated: { text: string; generator: string },
): SyntheticDocument {
  const { text, spans } = stripMarkers(generated.text)
  return documentFromSpans(spec, text, spans, generated.generator)
}

/** Preferred structured-annotation path: source text is never model-rewritten. */
export function normalizeAnnotated(
  spec: DocumentSpec,
  generated: { text: string; generator: string },
  spans: SyntheticDocument['spans'],
): SyntheticDocument {
  return documentFromSpans(spec, generated.text, spans, generated.generator)
}

function documentFromSpans(
  spec: DocumentSpec,
  text: string,
  spans: SyntheticDocument['spans'],
  generator: string,
): SyntheticDocument {
  const document = {
    id: spec.id,
    text,
    spans,
    generator,
    specCell: generationSpecIdentity(spec),
    matrixCells: spec.matrixCells,
    contentHash: contentHash(text),
    hardNegatives: spec.hardNegatives,
  }
  assertDocumentMatchesSpec(document, spec)
  return document
}

/** One fail-closed validation contract for generated and persisted documents. */
export function assertDocumentMatchesSpec(
  document: SyntheticDocument,
  spec: DocumentSpec,
) {
  if (document.id !== spec.id)
    throw new Error(`Document does not bind specification ${spec.id}`)
  if (document.contentHash !== contentHash(document.text))
    throw new Error(`${document.id} has an invalid content hash`)
  validateSpans(document.text, document.spans)
  const emitted = new Set(document.spans.map((span) => span.category))
  for (const category of spec.requiredCategories) {
    if (!emitted.has(category))
      throw new Error(`${spec.id} omitted required category ${category}`)
  }
  if (document.specCell !== generationSpecIdentity(spec))
    throw new Error(`${spec.id} has an invalid specification identity`)
  if (
    JSON.stringify([...document.matrixCells].sort()) !==
    JSON.stringify([...spec.matrixCells].sort())
  )
    throw new Error(`${spec.id} has invalid matrix coverage`)
  if (
    canonicalJson(document.hardNegatives ?? []) !==
    canonicalJson(spec.hardNegatives)
  )
    throw new Error(`${spec.id} has invalid hard-negative assertions`)
  assertHardNegatives(document.text, document.spans, spec.hardNegatives)
}

/** Verifies required neutral literals and forbids positive annotation overlap. */
export function assertHardNegatives(
  text: string,
  spans: SyntheticDocument['spans'],
  assertions: HardNegativeAssertion[],
) {
  for (const assertion of assertions) {
    const starts = occurrences(text, assertion.quote)
    if (starts.length !== assertion.expectedCount)
      throw new Error(
        `${assertion.id} expected ${assertion.expectedCount} source occurrence(s), found ${starts.length}`,
      )
    const start = starts[assertion.occurrence - 1]
    if (start === undefined)
      throw new Error(
        `${assertion.id} source occurrence ${assertion.occurrence} is missing`,
      )
    const end = start + assertion.quote.length
    const overlap = spans.find(
      (span) =>
        assertion.mustNotOverlap.includes(span.category) &&
        span.start < end &&
        start < span.end,
    )
    if (overlap)
      throw new Error(
        `${assertion.id} must not overlap ${overlap.category} annotation`,
      )
  }
}

export function contentHash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

export function normalizedShingles(text: string, size = 5) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return new Set(
    Array.from({ length: Math.max(0, words.length - size + 1) }, (_, index) =>
      words.slice(index, index + size).join(' '),
    ),
  )
}

export function nearDuplicateSignature(
  document: Pick<SyntheticDocument, 'id' | 'text' | 'contentHash'>,
): NearDuplicateSignature {
  return {
    id: document.id,
    textHash: document.contentHash,
    shingles: [...normalizedShingles(document.text)].sort(),
  }
}

function similarity(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((shingle) => right.has(shingle)).length
  const union = left.size + right.size - intersection
  return union === 0 ? 1 : intersection / union
}

/** Incremental deterministic index; never re-compares accepted documents. */
export class NearDuplicateIndex {
  private readonly entries = new Map<string, Set<string>>()
  constructor(
    private readonly threshold = 0.82,
    signatures: NearDuplicateSignature[] = [],
  ) {
    for (const signature of signatures)
      this.entries.set(signature.id, new Set(signature.shingles))
  }

  check(
    document: Pick<SyntheticDocument, 'id' | 'text'>,
  ): NearDuplicateMatch | undefined {
    const candidate = normalizedShingles(document.text)
    for (const [id, existing] of this.entries) {
      const value = similarity(candidate, existing)
      if (value >= this.threshold)
        return {
          left: document.id,
          right: id,
          similarity: Number(value.toFixed(4)),
        }
    }
    return undefined
  }

  add(document: Pick<SyntheticDocument, 'id' | 'text'>) {
    this.entries.set(document.id, normalizedShingles(document.text))
  }

  signatures(): NearDuplicateSignature[] {
    return [...this.entries].map(([id, shingles]) => ({
      id,
      textHash: '',
      shingles: [...shingles].sort(),
    }))
  }
}

/** Retained as a reference oracle for regression tests and small diagnostics. */
export function nearDuplicatePairs(
  documents: SyntheticDocument[],
  threshold = 0.82,
): NearDuplicateMatch[] {
  const pairs: NearDuplicateMatch[] = []
  const documentShingles = documents.map((document) =>
    normalizedShingles(document.text),
  )
  for (let left = 0; left < documents.length; left++) {
    for (let right = 0; right < left; right++) {
      const value = similarity(
        documentShingles[left]!,
        documentShingles[right]!,
      )
      if (value >= threshold)
        pairs.push({
          left: documents[left]!.id,
          right: documents[right]!.id,
          similarity: Number(value.toFixed(4)),
        })
    }
  }
  return pairs
}

function occurrences(source: string, quote: string) {
  const found: number[] = []
  for (
    let index = source.indexOf(quote);
    index !== -1;
    index = source.indexOf(quote, index + 1)
  )
    found.push(index)
  return found
}
