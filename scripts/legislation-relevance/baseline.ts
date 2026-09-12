import type { LegislationRelevanceBaseline } from './metrics'

// Observed floors from POST /api/search/fetch on the product corpus at
// documentCount 184772. These record today's behaviour including the failures;
// ranking work ratchets them, it does not tidy failing cases out of the set.
//
// heldPrecision is computed over complete-answer (exact) held cases only: a
// subject-matter query's relevant set is a lower bound, so there is no honest
// precision to score for it. Subject recall is reported separately.
//
// The floors are not targets. Every absent_act case still serves five
// provisions a lawyer did not ask for, and subject recall is 0.3125 because the
// served top five are an insertion-order tie broken on identifier path. Those
// are the numbers L3 and L23 have to argue from.
export const legislationRelevanceBaseline: LegislationRelevanceBaseline = {
  expectedCaseCount: 52,
  expectedIndexDocumentCount: 184772,
  heldRecall: 0.7903,
  heldPrecision: 0.9565,
  absentPrecision: 0.4286,
  mrr: 0.7823,
  byQuery: {
    'act-human-rights-1998': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-equality-2010': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-online-safety-2023': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-employment-rights-2025': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-leasehold-freehold-2024': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-data-use-access-2025': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-mental-health-2025': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-victims-prisoners-2024': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-hra-alias': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-renters-rights-curly': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'act-renters-rights-straight': {
      recall: 0,
      ranks: [null],
      returnedHitCount: 5,
    },
    'chapter-hra-1998-c42': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-hra-s6': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-hra-s6-alias': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-hra-s2-of-the': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-ea-s13': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-ea-s20': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-ea-s20-3': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-ea-s40-act-first': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-ea-s149': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-ea-sch1-para1': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-osa-s1': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'section-era-2025-s1': { recall: 1, ranks: [1], returnedHitCount: 1 },
    'subject-flexible-working': {
      recall: 0.5,
      ranks: [1, null],
      returnedHitCount: 5,
    },
    'subject-carers-leave': {
      recall: 0,
      ranks: [null, null],
      returnedHitCount: 5,
    },
    'subject-neonatal-care-leave': {
      recall: 0,
      ranks: [null, null],
      returnedHitCount: 5,
    },
    'subject-protected-characteristic': {
      recall: 0,
      ranks: [null],
      returnedHitCount: 5,
    },
    'subject-reasonable-adjustments': {
      recall: 0,
      ranks: [null, null],
      returnedHitCount: 5,
    },
    'subject-ground-rent': {
      recall: 0,
      ranks: [null, null],
      returnedHitCount: 5,
    },
    'subject-higher-risk-building': {
      recall: 1,
      ranks: [4],
      returnedHitCount: 5,
    },
    'subject-allocation-of-tips': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 5,
    },
    'absent-act-children-1989': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-data-protection-2018': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-companies-2006': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-landlord-tenant-1985': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-limitation-1980': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-misuse-drugs-1971': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-sale-of-goods-1979': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-proceeds-crime-2002': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-employment-rights-1996': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-act-housing-2004': { recall: null, ranks: [], returnedHitCount: 5 },
    'absent-act-criminal-justice-2003': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'absent-chapter-2008-c12': { recall: null, ranks: [], returnedHitCount: 5 },
    'absent-provision-ea-s999': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-provision-osa-s500': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-provision-ea-sch99': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-concept-proportionality': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-concept-mens-rea': { recall: null, ranks: [], returnedHitCount: 0 },
    'absent-concept-res-judicata': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-concept-promissory-estoppel': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-concept-quantum-meruit': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-concept-zygote': { recall: null, ranks: [], returnedHitCount: 0 },
  },
}
