export const searchBenchmarkBaseline = {
  // Minimums are floors set to current observed behaviour. The PR that improves
  // a metric tightens its floor: #53 raises short-word precision from 0.2 to 1;
  // #54 raises no-answer precision and content-word recall to 1. The three
  // court-code cases raised top-1 and top-3 exact-source success to 41/44
  // (0.9318). The party-name typo objective brings the case count to 54, and
  // lowering the default rankingScoreThreshold from 0.5 to 0.25 makes
  // party-rizwan-one-typo pass, so top-1 and top-3 tighten to 42/45 (0.9333).
  // The numeric dateDecidedTimestamp filter fixes the three date cases, which
  // were the only remaining misses, so both tighten to 45/45.
  expectedCaseCount: 54,
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
  // Empty. Meilisearch comparison operators accept numeric operands only, and
  // toMeiliFilters now emits the derived dateDecidedTimestamp instead of a
  // quoted date string, so the three date cases no longer error.
  knownFailingCaseIds: [],
  maximumSearchWallClockP95Ms: 250,
} as const
