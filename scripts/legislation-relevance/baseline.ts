import type { LegislationRelevanceBaseline } from './metrics'

// Observed floors from POST /api/search/fetch on the product corpus at
// documentCount 184772. These record today's behaviour; ranking work ratchets
// them, it does not tidy failing cases out of the set.
//
// heldPrecision is computed over complete-answer (exact) held cases only: a
// subject-matter query's relevant set is a lower bound, so there is no honest
// precision to score for it. Subject recall is reported separately.
//
// The floors are not targets. absentPrecision is 1: every absent Act, chapter,
// provision and concept query is answered with no hits, because a recognised
// citation the corpus does not hold is named as not held instead of being
// filled with provisions that merely share its words. Held recall is 0.8854;
// the remaining gap is subject recall, 0.3125, where the served top five are an
// insertion-order tie broken on identifier path. That is what L23 has to argue
// from.
//
// heldNotHeldViolations is the invariant this suite exists to protect: a held
// expectation must never receive an authoritative not-held verdict. The
// resolved title states (a terminal `(repealed)` annotation, dropped
// apostrophes and hyphens, `&` as `and`, dropped `etc`) and the control queries
// (prose clauses and the underspecified "Act 2020") are scored so a future fold
// regression fails here rather than shipping a false claim. A control query is
// never scored for hits; its invariant is that it makes no unsupported claim.

export const legislationRelevanceBaseline: LegislationRelevanceBaseline = {
  expectedCaseCount: 77,
  expectedIndexDocumentCount: 184772,
  heldRecall: 0.8854,
  heldPrecision: 1,
  absentPrecision: 1,
  mrr: 0.8802,
  heldNotHeldViolations: 0,
  byQuery: {
    'act-human-rights-1998': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-equality-2010': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-online-safety-2023': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
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
    'act-data-use-access-2025': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-mental-health-2025': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-victims-prisoners-2024': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-hra-alias': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-renters-rights-curly': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-renters-rights-straight': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-health-social-care-levy-2021': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-non-domestic-rating-public-lavatories-2021': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-trade-australia-new-zealand-2023': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-strikes-minimum-service-levels-2023': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-workers-predictable-terms-2023': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-safety-rwanda-2024': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-childrens-wellbeing-2026': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-carers-leave-2023': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-skills-post-16-2022': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-non-domestic-rating-lists-2021': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-cooperatives-mutuals-2023': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-compensation-london-capital-2021': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-property-digital-assets-2025': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-social-security-uprating-2020': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-trade-trans-pacific-2024': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'act-high-speed-rail-crewe-2021': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'chapter-hra-1998-c42': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-hra-s6': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-hra-s6-alias': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-hra-s2-of-the': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-ea-s13': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-ea-s20': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-ea-s20-3': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-ea-s40-act-first': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-ea-s149': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-ea-sch1-para1': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-osa-s1': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-era-2025-s1': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
    'section-health-social-care-levy-s5': {
      recall: 1,
      ranks: [1],
      returnedHitCount: 1,
    },
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
      returnedHitCount: 0,
    },
    'absent-act-data-protection-2018': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-companies-2006': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-landlord-tenant-1985': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-limitation-1980': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-misuse-drugs-1971': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-sale-of-goods-1979': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-proceeds-crime-2002': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-employment-rights-1996': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-housing-2004': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-act-criminal-justice-2003': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'absent-chapter-2008-c12': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
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
    'absent-concept-mens-rea': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
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
    'absent-concept-zygote': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'control-defences-children-1989': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'control-computer-misuse-1990': {
      recall: null,
      ranks: [],
      returnedHitCount: 0,
    },
    'control-act-2020': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'control-duties-equality-2010': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'control-offences-misuse-drugs-1971': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'control-sentencing-criminal-justice-2003': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
    'control-changes-companies-2006': {
      recall: null,
      ranks: [],
      returnedHitCount: 4,
    },
    'control-defences-children-1989-plain': {
      recall: null,
      ranks: [],
      returnedHitCount: 5,
    },
  },
}
