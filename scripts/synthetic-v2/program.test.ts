import { describe, expect, it } from 'vitest'
import {
  assertDisjointStages,
  corpusProgramme,
  corpusStageSpecs,
} from './program'

describe('staged synthetic-v2 corpus programme', () => {
  it('defines the approved initial corpus sizes', () => {
    expect(corpusProgramme.tournament.documents).toBe(24)
    expect(corpusProgramme.training_seed.documents).toBe(600)
    expect(corpusProgramme.development_challenge.documents).toBe(100)
    expect(corpusProgramme.benchmark.documents).toBe(280)
  })

  it('has reproducible, disjoint stage specifications', () => {
    assertDisjointStages([
      'tournament',
      'training_seed',
      'development_challenge',
      'benchmark',
    ])
    expect(corpusStageSpecs('tournament')).toHaveLength(24)
  })
})
