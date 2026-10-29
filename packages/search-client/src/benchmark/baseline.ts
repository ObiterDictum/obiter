interface RecallFloorMap {
  [query: string]: number
}

export const searchBenchmarkBaseline = {
  expectedCaseCount: 55,
  minimumTop1ExactSourceSuccess: 1,
  minimumTop3ExactSourceSuccess: 1,
  minimumExactLookupTop1Success: 1,
  minimumShortWordPrecision: 1,
  minimumEvidenceUnitRecall: 1,
  minimumNoAnswerPrecision: 1,
  minimumContentWordRecall: 1,
  minimumMalformedCitationNoResultRate: 1,
  minimumAmbiguitySurfaced: 1,
  minimumEngineRankingScoreCoverage: 1,
  knownFailingCaseIds: [],
  maximumSearchWallClockP95Ms: 250,
  expectedRecallQueryCount: 19,
  minimumRecall: 0.8333,
  minimumPrecision: 1,
  // SAFETY: every value in the literal below is a numeric recall floor, so widening the inferred literal types to a string-keyed numeric record for per-query lookup in recall.ts is sound; established by inspection of those entries.
  minimumRecallByQuery: {
    'recall-cite-uksc-2024-3': 1,
    'recall-cite-ewca-partial': 1,
    'recall-cite-uksc-partial': 1,
    'recall-cite-malformed': 1,
    'recall-party-potanina': 1,
    'recall-party-rizwan': 1,
    'recall-party-typo': 1,
    'recall-party-ambiguous-smith': 1,
    'recall-party-ambiguous-brown': 1,
    'recall-subject-psychiatric': 0,
    'recall-subject-candour': 1,
    'recall-subject-estoppel': 0.5,
    'recall-subject-remedy': 1,
    'recall-subject-self-incrimination': 1,
    'recall-subject-carlill': 0,
  } as RecallFloorMap,
} as const
