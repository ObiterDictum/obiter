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
  maximumSearchErrors: 3,
  maximumStoredSearchP95Ms: 100,
} as const
