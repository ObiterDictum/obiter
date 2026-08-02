export const searchBenchmarkBaseline = {
  expectedCaseCount: 50,
  minimumTop1ExactSourceSuccess: 0.9231,
  minimumTop3ExactSourceSuccess: 0.9231,
  minimumExactLookupTop1Success: 1,
  minimumShortWordPrecision: 0.2,
  minimumEvidenceUnitRecall: 1,
  minimumNoAnswerPrecision: 0,
  minimumMalformedCitationNoResultRate: 0.3333,
  minimumAmbiguitySurfaced: 1,
  // Meilisearch comparison operators (>=, <=) accept numeric operands only, so
  // toMeiliFilters emitting `dateDecided >= "2019-12-31"` is rejected. Fixing it
  // needs a numeric dateDecidedTimestamp field on the document schema, which is
  // tracked separately. Until then these three cases are expected to error.
  knownFailingCaseIds: [
    'date-brown-from-1994',
    'date-potanina-2024',
    'date-smith-before-2019',
  ],
  maximumSearchWallClockP95Ms: 250,
} as const
