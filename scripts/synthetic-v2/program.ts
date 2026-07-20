import { buildQuotaSpecs } from './matrix'
import type { DocumentSpec } from './types'

/**
 * Deliberately small, staged corpus programme. A stage must be selected
 * explicitly by the runner; this module never invokes a provider.
 */
export const corpusProgramme = {
  tournament: {
    documents: 24,
    prefix: 'tournament',
    purpose:
      'Compare candidate writer/annotator pairs on fixed specifications.',
  },
  training_seed: {
    documents: 600,
    prefix: 'train-seed',
    purpose:
      'Private initial fine-tuning corpus; expand only after evaluation.',
  },
  development_challenge: {
    documents: 100,
    prefix: 'challenge',
    purpose: 'Private model-selection and adversarial regression set.',
  },
  benchmark: {
    documents: 280,
    prefix: 'benchmark',
    purpose: 'Frozen public comparison benchmark.',
  },
} as const

export type CorpusStage = keyof typeof corpusProgramme

export function corpusStageSpecs(stage: CorpusStage): DocumentSpec[] {
  const definition = corpusProgramme[stage]
  return buildQuotaSpecs(definition.documents, definition.prefix)
}

export function isCorpusStage(value: string | undefined): value is CorpusStage {
  return Boolean(value && value in corpusProgramme)
}

/** Stable IDs/seeds make the intended partitions auditable before generation. */
export function assertDisjointStages(stages: CorpusStage[]) {
  const seen = new Set<string>()
  for (const stage of stages) {
    for (const spec of corpusStageSpecs(stage)) {
      if (seen.has(spec.id) || seen.has(spec.seed))
        throw new Error(`Corpus stage collision for ${stage}: ${spec.id}`)
      seen.add(spec.id)
      seen.add(spec.seed)
    }
  }
}
