export const searchBenchmarkBaseline = {
  // Minimums are floors set to current observed behaviour. The PR that improves
  // a metric tightens its floor: #53 raises short-word precision from 0.2 to 1;
  // #54 raises no-answer precision and content-word recall to 1. The three
  // court-code cases raised top-1 and top-3 exact-source success to 41/44
  // (0.9318). The party-name typo objective brings the case count to 54, and
  // lowering the default rankingScoreThreshold from 0.5 to 0.25 makes
  // party-rizwan-one-typo pass, so top-1 and top-3 tighten to 42/45 (0.9333).
  // The three date cases below are the only remaining misses; both metrics
  // should be 1 when the date filter is fixed.
  expectedCaseCount: 54,
  minimumTop1ExactSourceSuccess: 0.9333,
  minimumTop3ExactSourceSuccess: 0.9333,
  minimumExactLookupTop1Success: 1,
  minimumShortWordPrecision: 1,
  minimumEvidenceUnitRecall: 1,
  minimumNoAnswerPrecision: 1,
  minimumContentWordRecall: 1,
  minimumMalformedCitationNoResultRate: 1,
  minimumAmbiguitySurfaced: 1,
  minimumEngineRankingScoreCoverage: 1,
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
