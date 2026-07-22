import { evaluateSpans, scoreHardNegativeAssertions } from './metrics'
import type { QaEvidence } from './qa'
import type { SyntheticDocument } from './types'

function requiredPrediction(
  predictions: Map<string, SyntheticDocument['spans']>,
  documentId: string,
  label: string,
) {
  const prediction = predictions.get(documentId)
  if (!prediction)
    throw new Error(`Missing ${label} annotation prediction for ${documentId}`)
  return prediction
}

/**
 * Scores labeler output only against a reference independently agreed by two
 * judges (or recorded human adjudication), never against the labeler itself.
 */
export function scoreAdjudicatedDocuments(
  documents: SyntheticDocument[],
  qa: Map<string, QaEvidence>,
  finalPassAnnotations: Map<string, SyntheticDocument['spans']>,
  firstPassAnnotations: Map<string, SyntheticDocument['spans']> = new Map(),
) {
  const evaluated = documents.map((document) => {
    const evidence = qa.get(document.id)
    const reference = evidence?.adjudicatedReference
    if (!reference)
      throw new Error(
        `Missing independently adjudicated reference for ${document.id}`,
      )
    return {
      id: document.id,
      gold: reference.spans,
      predicted: requiredPrediction(finalPassAnnotations, document.id, 'final'),
    }
  })
  const firstPass = documents.map((document) => ({
    ...document,
    spans: requiredPrediction(firstPassAnnotations, document.id, 'first-pass'),
  }))
  const finalPass = documents.map((document) => ({
    ...document,
    spans: requiredPrediction(finalPassAnnotations, document.id, 'final'),
  }))
  return {
    entity: evaluateSpans(evaluated),
    hardNegatives: {
      firstPass: scoreHardNegativeAssertions(firstPass),
      final: scoreHardNegativeAssertions(finalPass),
    },
    firstPass: {
      entity: evaluateSpans(
        evaluated.map((entry) => ({
          ...entry,
          predicted: requiredPrediction(
            firstPassAnnotations,
            entry.id,
            'first-pass',
          ),
        })),
      ),
    },
  }
}
