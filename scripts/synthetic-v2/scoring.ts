import { evaluateSpans, scoreHardNegativeAssertions } from './metrics'
import type { QaEvidence } from './qa'
import type { SyntheticDocument } from './types'

/**
 * Scores labeler output only against a reference independently agreed by two
 * judges (or recorded human adjudication), never against the labeler itself.
 */
export function scoreAdjudicatedDocuments(
  documents: SyntheticDocument[],
  qa: Map<string, QaEvidence>,
  firstPassAnnotations: Map<string, SyntheticDocument['spans']> = new Map(),
) {
  const evaluated = documents.map((document) => {
    const evidence = qa.get(document.id)
    const reference = evidence?.adjudicatedReference
    if (!reference)
      throw new Error(
        `Missing independently adjudicated reference for ${document.id}`,
      )
    return { id: document.id, gold: reference.spans, predicted: document.spans }
  })
  const firstPass = documents.map((document) => ({
    ...document,
    spans: firstPassAnnotations.get(document.id) ?? document.spans,
  }))
  return {
    // Final/post-repair metrics are retained, but never overwrite first pass.
    entity: evaluateSpans(evaluated),
    hardNegatives: {
      firstPass: scoreHardNegativeAssertions(firstPass),
      final: scoreHardNegativeAssertions(documents),
    },
    firstPass: {
      entity: evaluateSpans(
        evaluated.map((entry) => ({
          ...entry,
          predicted: firstPassAnnotations.get(entry.id) ?? entry.predicted,
        })),
      ),
    },
  }
}
