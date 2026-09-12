/**
 * Labelled queries for the legislation relevance suite.
 *
 * These are queries a solicitor would type against the provision corpus:
 * statute short titles, chapter numbers, section and schedule lookups, and
 * subject-matter phrases. Every held expectation is verified against Postgres
 * before a run (corpus.ts), so an expectation that has drifted fails loudly
 * instead of quietly scoring.
 *
 * Two scoring models, because the two kinds of query are not the same problem:
 *
 * - `exact`: the query names one entity, so `expectedIds` is the complete
 *   answer. Recall, precision, and MRR are all scored. A stray provision in
 *   the served group is a false positive.
 * - `subject`: the query names a concept. `expectedIds` lists the provisions
 *   that establish it — the definition and the operative right or duty — in
 *   each held Act that legislates it, and is a verified lower bound on the
 *   relevant set, not the whole of it. Recall and MRR are scored; precision
 *   is not, because a concept query's complete relevant set is not
 *   enumerable and a hand-labelled set would make precision meaningless.
 *
 * Absent cases are the point of the set. A query whose correct answer is
 * nothing either names an entity the corpus does not hold, a provision that
 * does not exist, a chapter number with no stored Act, or a legal concept no
 * provision states. With matchingStrategy 'all' the engine can still return
 * provisions that merely mention the words, and on a short provision those
 * mentions are how a plausible non-answer gets served as if it were one.
 */
export type LegislationRelevanceKind = 'held' | 'absent'

export type LegislationRelevanceCategory =
  | 'act_name'
  | 'chapter_number'
  | 'section_lookup'
  | 'subject_matter'
  | 'absent_act'
  | 'absent_provision'
  | 'absent_concept'

export type LegislationRelevanceScoring = 'exact' | 'subject'

/** What makes an absent expectation correct, checked against Postgres. */
export type LegislationAbsentCheck =
  | { kind: 'act_not_held'; title: string }
  | { kind: 'provision_not_held'; provisionId: string }
  | { kind: 'chapter_not_held'; year: number; number: number }
  | { kind: 'term_not_in_corpus'; terms: string[] }

export interface LegislationRelevanceCase {
  id: string
  kind: LegislationRelevanceKind
  category: LegislationRelevanceCategory
  query: string
  /**
   * Canonical identity paths that must appear in the served legislation
   * group: `ukpga/1998/42` for an Act, `ukpga/1998/42/section/6` for a
   * provision. Held cases only; empty for absent.
   */
  expectedIds: string[]
  scoring: LegislationRelevanceScoring
  absentCheck?: LegislationAbsentCheck
}

type HeldRow = readonly [
  id: string,
  query: string,
  expectedIds: readonly string[],
]

function held(
  category: LegislationRelevanceCategory,
  scoring: LegislationRelevanceScoring,
  rows: readonly HeldRow[],
): LegislationRelevanceCase[] {
  return rows.map(([id, query, expectedIds]) => ({
    id,
    kind: 'held',
    category,
    query,
    expectedIds: [...expectedIds],
    scoring,
  }))
}

type AbsentRow = readonly [
  id: string,
  query: string,
  check: LegislationAbsentCheck,
]

function absent(
  category: LegislationRelevanceCategory,
  rows: readonly AbsentRow[],
): LegislationRelevanceCase[] {
  return rows.map(([id, query, absentCheck]) => ({
    id,
    kind: 'absent',
    category,
    query,
    expectedIds: [],
    scoring: 'exact',
    absentCheck,
  }))
}

const actNameHeld = held('act_name', 'exact', [
  ['act-human-rights-1998', 'Human Rights Act 1998', ['ukpga/1998/42']],
  ['act-equality-2010', 'Equality Act 2010', ['ukpga/2010/15']],
  ['act-online-safety-2023', 'Online Safety Act 2023', ['ukpga/2023/50']],
  [
    'act-employment-rights-2025',
    'Employment Rights Act 2025',
    ['ukpga/2025/36'],
  ],
  [
    'act-leasehold-freehold-2024',
    'Leasehold and Freehold Reform Act 2024',
    ['ukpga/2024/22'],
  ],
  [
    'act-data-use-access-2025',
    'Data (Use and Access) Act 2025',
    ['ukpga/2025/18'],
  ],
  ['act-mental-health-2025', 'Mental Health Act 2025', ['ukpga/2025/33']],
  [
    'act-victims-prisoners-2024',
    'Victims and Prisoners Act 2024',
    ['ukpga/2024/21'],
  ],
  ['act-hra-alias', 'HRA 1998', ['ukpga/1998/42']],
  // The stored title carries a curly apostrophe (Renters’ Rights Act 2025).
  // Both surface forms are typed, and both name the same Act; the straight
  // apostrophe is the one a UK keyboard produces.
  ['act-renters-rights-curly', 'Renters’ Rights Act 2025', ['ukpga/2025/26']],
  [
    'act-renters-rights-straight',
    "Renters' Rights Act 2025",
    ['ukpga/2025/26'],
  ],
])

const chapterHeld = held('chapter_number', 'exact', [
  ['chapter-hra-1998-c42', '1998 c. 42', ['ukpga/1998/42']],
])

const sectionHeld = held('section_lookup', 'exact', [
  ['section-hra-s6', 's. 6 Human Rights Act 1998', ['ukpga/1998/42/section/6']],
  ['section-hra-s6-alias', 's. 6 HRA 1998', ['ukpga/1998/42/section/6']],
  [
    'section-hra-s2-of-the',
    'section 2 of the Human Rights Act 1998',
    ['ukpga/1998/42/section/2'],
  ],
  ['section-ea-s13', 's. 13 Equality Act 2010', ['ukpga/2010/15/section/13']],
  ['section-ea-s20', 's. 20 Equality Act 2010', ['ukpga/2010/15/section/20']],
  [
    'section-ea-s20-3',
    's. 20(3) Equality Act 2010',
    ['ukpga/2010/15/section/20/3'],
  ],
  [
    'section-ea-s40-act-first',
    'Equality Act 2010 s. 40',
    ['ukpga/2010/15/section/40'],
  ],
  [
    'section-ea-s149',
    's. 149 Equality Act 2010',
    ['ukpga/2010/15/section/149'],
  ],
  [
    'section-ea-sch1-para1',
    'Sch. 1 para. 1 Equality Act 2010',
    ['ukpga/2010/15/schedule/1/paragraph/1'],
  ],
  [
    'section-osa-s1',
    's. 1 Online Safety Act 2023',
    ['ukpga/2023/50/section/1'],
  ],
  [
    'section-era-2025-s1',
    's. 1 Employment Rights Act 2025',
    ['ukpga/2025/36/section/1'],
  ],
])

const subjectHeld = held('subject_matter', 'subject', [
  // Spans the Employment Relations (Flexible Working) Act 2023 and the
  // consolidating Employment Rights Act 2025.
  [
    'subject-flexible-working',
    'flexible working',
    ['ukpga/2023/33/section/1', 'ukpga/2025/36/section/9'],
  ],
  // Spans the Carer's Leave Act 2023 and the Employment Rights Act 2025
  // consequential amendments. The entitlement itself is created by
  // paragraph 2 of the 2023 Act's Schedule; the Schedule is unnumbered, so
  // the label path has no schedule number.
  [
    'subject-carers-leave',
    "carer's leave",
    ['ukpga/2023/18/section/1', 'ukpga/2023/18/schedule/paragraph/2'],
  ],
  // Spans the Neonatal Care (Leave and Pay) Act 2023 and the Employment
  // Rights Act 2025.
  [
    'subject-neonatal-care-leave',
    'neonatal care leave',
    ['ukpga/2023/20/section/1', 'ukpga/2023/20/schedule/paragraph/2'],
  ],
  // Spans the Equality Act 2010 and the Acts that use the term; section 4
  // is the definition.
  [
    'subject-protected-characteristic',
    'protected characteristic',
    ['ukpga/2010/15/section/4'],
  ],
  // Sections 20 and 21 are the reasonable-adjustments duty; section 22 is
  // supplementary and does not carry the phrase, so it is not matched by an
  // 'all' strategy query at all.
  [
    'subject-reasonable-adjustments',
    'reasonable adjustments',
    ['ukpga/2010/15/section/20', 'ukpga/2010/15/section/21'],
  ],
  // Spans the Leasehold Reform (Ground Rent) Act 2022 and the Leasehold and
  // Freehold Reform Act 2024. Sections 1 and 3 of the 2022 Act define the
  // regulated lease and prohibit the prohibited rent.
  [
    'subject-ground-rent',
    'ground rent',
    ['ukpga/2022/1/section/1', 'ukpga/2022/1/section/3'],
  ],
  // Spans the Building Safety Act 2022 and the Leasehold and Freehold
  // Reform Act 2024; section 65 defines a higher-risk building.
  [
    'subject-higher-risk-building',
    'higher-risk building',
    ['ukpga/2022/30/section/65'],
  ],
  [
    'subject-allocation-of-tips',
    'allocation of tips',
    ['ukpga/2023/13/section/1'],
  ],
])

const absentAct = absent('absent_act', [
  [
    'absent-act-children-1989',
    'Children Act 1989',
    { kind: 'act_not_held', title: 'Children Act 1989' },
  ],
  [
    'absent-act-data-protection-2018',
    'Data Protection Act 2018',
    { kind: 'act_not_held', title: 'Data Protection Act 2018' },
  ],
  [
    'absent-act-companies-2006',
    'Companies Act 2006',
    { kind: 'act_not_held', title: 'Companies Act 2006' },
  ],
  [
    'absent-act-landlord-tenant-1985',
    'Landlord and Tenant Act 1985',
    { kind: 'act_not_held', title: 'Landlord and Tenant Act 1985' },
  ],
  [
    'absent-act-limitation-1980',
    'Limitation Act 1980',
    { kind: 'act_not_held', title: 'Limitation Act 1980' },
  ],
  [
    'absent-act-misuse-drugs-1971',
    'Misuse of Drugs Act 1971',
    { kind: 'act_not_held', title: 'Misuse of Drugs Act 1971' },
  ],
  [
    'absent-act-sale-of-goods-1979',
    'Sale of Goods Act 1979',
    { kind: 'act_not_held', title: 'Sale of Goods Act 1979' },
  ],
  [
    'absent-act-proceeds-crime-2002',
    'Proceeds of Crime Act 2002',
    { kind: 'act_not_held', title: 'Proceeds of Crime Act 2002' },
  ],
  [
    'absent-act-employment-rights-1996',
    'Employment Rights Act 1996',
    { kind: 'act_not_held', title: 'Employment Rights Act 1996' },
  ],
  [
    'absent-act-housing-2004',
    'Housing Act 2004',
    { kind: 'act_not_held', title: 'Housing Act 2004' },
  ],
  [
    'absent-act-criminal-justice-2003',
    'Criminal Justice Act 2003',
    { kind: 'act_not_held', title: 'Criminal Justice Act 2003' },
  ],
])

const absentChapter = absent('absent_act', [
  [
    'absent-chapter-2008-c12',
    '2008 c. 12',
    { kind: 'chapter_not_held', year: 2008, number: 12 },
  ],
])

const absentProvision = absent('absent_provision', [
  [
    'absent-provision-ea-s999',
    's. 999 Equality Act 2010',
    { kind: 'provision_not_held', provisionId: 'ukpga/2010/15/section/999' },
  ],
  [
    'absent-provision-osa-s500',
    'section 500 Online Safety Act 2023',
    { kind: 'provision_not_held', provisionId: 'ukpga/2023/50/section/500' },
  ],
  [
    'absent-provision-ea-sch99',
    'Sch. 99 para. 1 Equality Act 2010',
    {
      kind: 'provision_not_held',
      provisionId: 'ukpga/2010/15/schedule/99/paragraph/1',
    },
  ],
])

// Concepts no held provision states. These are the absent queries that should
// pass today; they keep absent precision from being measured only on the
// entity-not-held class, and they fail the moment a ranking change widens the
// matched set enough to reach boilerplate.
const absentConcept = absent('absent_concept', [
  [
    'absent-concept-proportionality',
    'proportionality',
    { kind: 'term_not_in_corpus', terms: ['proportionality'] },
  ],
  [
    'absent-concept-mens-rea',
    'mens rea',
    { kind: 'term_not_in_corpus', terms: ['mens rea'] },
  ],
  [
    'absent-concept-res-judicata',
    'res judicata',
    { kind: 'term_not_in_corpus', terms: ['res judicata'] },
  ],
  [
    'absent-concept-promissory-estoppel',
    'promissory estoppel',
    { kind: 'term_not_in_corpus', terms: ['promissory estoppel'] },
  ],
  [
    'absent-concept-quantum-meruit',
    'quantum meruit',
    { kind: 'term_not_in_corpus', terms: ['quantum meruit'] },
  ],
  [
    'absent-concept-zygote',
    'Zygote Regulation Act 2024',
    { kind: 'term_not_in_corpus', terms: ['zygote'] },
  ],
])

export const legislationRelevanceCases: LegislationRelevanceCase[] = [
  ...actNameHeld,
  ...chapterHeld,
  ...sectionHeld,
  ...subjectHeld,
  ...absentAct,
  ...absentChapter,
  ...absentProvision,
  ...absentConcept,
]

/**
 * Served legislation keyword hits per query. The API requests
 * `keywordLimit ?? 5` from the index, so five is what a caller receives and
 * what the suite scores; measuring more would measure a result page the
 * product does not serve.
 */
export const legislationRelevanceTopK = 5
