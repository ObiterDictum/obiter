export type CorpusRelevanceKind = 'held' | 'absent'

export type CorpusRelevanceCategory =
  'party_name' | 'neutral_citation' | 'document_id'

/**
 * Courts the expectation is drawn from. UKSC, UKPC and both Court of Appeal
 * divisions are complete in this corpus and will not grow; High Court is
 * 2020-onward and will gain pre-2020 material later. Absent UKHL citations
 * are not a Find Case Law court in this ingest.
 */
export type CorpusCourtFamily =
  'uksc' | 'ukpc' | 'ewca-civ' | 'ewca-crim' | 'ukhl' | 'ewhc'

export const completeCourtFamilies = [
  'uksc',
  'ukpc',
  'ewca-civ',
  'ewca-crim',
] as const satisfies readonly CorpusCourtFamily[]

export interface CorpusRelevanceCase {
  id: string
  kind: CorpusRelevanceKind
  category: CorpusRelevanceCategory
  query: string
  /** Held: document ids that must appear. Absent: empty. */
  expectedIds: string[]
  courtFamily: CorpusCourtFamily
}

type HeldRow = readonly [
  id: string,
  query: string,
  expectedIds: readonly string[],
  courtFamily: CorpusCourtFamily,
]

function held(
  category: CorpusRelevanceCategory,
  rows: readonly HeldRow[],
): CorpusRelevanceCase[] {
  return rows.map(([id, query, expectedIds, courtFamily]) => ({
    id,
    kind: 'held',
    category,
    query,
    expectedIds: [...expectedIds],
    courtFamily,
  }))
}

function absent(
  rows: ReadonlyArray<
    readonly [id: string, query: string, courtFamily: CorpusCourtFamily]
  >,
): CorpusRelevanceCase[] {
  return rows.map(([id, query, courtFamily]) => ({
    id,
    kind: 'absent',
    category: 'neutral_citation',
    query,
    expectedIds: [],
    courtFamily,
  }))
}

const partyHeld = held('party_name', [
  ['party-okpabi', 'Okpabi', ['uksc-2021-3'], 'uksc'],
  ['party-guest', 'Guest', ['uksc-2022-27'], 'uksc'],
  ['party-guest-v-guest', 'Guest v Guest', ['uksc-2022-27'], 'uksc'],
  ['party-vedanta', 'Vedanta', ['uksc-2019-20'], 'uksc'],
  ['party-lungowe-v-vedanta', 'Lungowe v Vedanta', ['uksc-2019-20'], 'uksc'],
  ['party-miller', 'Miller', ['uksc-2017-5'], 'uksc'],
  ['party-gina-miller', 'Gina Miller', ['uksc-2017-5', 'uksc-2019-41'], 'uksc'],
  ['party-jones', 'Jones', ['uksc-2011-13'], 'uksc'],
  ['party-prest', 'Prest', ['uksc-2013-34'], 'uksc'],
  ['party-montgomery', 'Montgomery', ['uksc-2015-11'], 'uksc'],
  ['party-lloyd-v-google', 'Lloyd v Google', ['uksc-2021-50'], 'uksc'],
  [
    'party-radmacher',
    'Radmacher',
    ['uksc-2010-42', 'ewca-civ-2009-649', 'ewca-civ-2008-1304'],
    'uksc',
  ],
  ['party-fearn', 'Fearn', ['uksc-2023-4'], 'uksc'],
  ['party-pimlico-plumbers', 'Pimlico Plumbers', ['uksc-2018-29'], 'uksc'],
  ['party-patel-v-mirza', 'Patel v Mirza', ['uksc-2016-42'], 'uksc'],
  ['party-uber-bv', 'Uber BV', ['uksc-2021-5'], 'uksc'],
  ['party-aslam-v-uber', 'Aslam v Uber', ['uksc-2021-5'], 'uksc'],
  ['party-harpur-trust', 'Harpur Trust', ['uksc-2022-21'], 'uksc'],
  ['party-potanina', 'Potanina', ['uksc-2024-3'], 'uksc'],
  ['party-fca-v-arch', 'FCA v Arch', ['uksc-2021-1'], 'uksc'],
  ['party-arch-insurance', 'Arch Insurance', ['uksc-2021-1'], 'uksc'],
  [
    'party-paul-v-wolverhampton',
    'Paul v Royal Wolverhampton',
    ['uksc-2024-1'],
    'uksc',
  ],
  ['party-zxc', 'ZXC', ['uksc-2022-5'], 'uksc'],
  [
    'party-swift-v-carpenter',
    'Swift v Carpenter',
    ['ewca-civ-2020-1295'],
    'ewca-civ',
  ],
  // Misspelled party query: the EWCA title shares two of three terms while
  // apex-court bodies merely mention the name, so the title-partial tier
  // must lift it above body mentions (Finding 1 gate).
  [
    'party-donoghue-stevnson',
    'Donoghue v Stevnson',
    ['ewca-civ-2003-231'],
    'ewca-civ',
  ],
])

const citationHeld = held('neutral_citation', [
  [
    'cite-ewca-civ-2024-123',
    '[2024] EWCA Civ 123',
    ['ewca-civ-2024-123'],
    'ewca-civ',
  ],
  ['cite-uksc-2021-3', '[2021] UKSC 3', ['uksc-2021-3'], 'uksc'],
  ['cite-uksc-2022-27', '[2022] UKSC 27', ['uksc-2022-27'], 'uksc'],
  ['cite-uksc-2019-20', '[2019] UKSC 20', ['uksc-2019-20'], 'uksc'],
  ['cite-uksc-2017-5', '[2017] UKSC 5', ['uksc-2017-5'], 'uksc'],
  ['cite-uksc-2013-34', '[2013] UKSC 34', ['uksc-2013-34'], 'uksc'],
  ['cite-uksc-2015-11', '[2015] UKSC 11', ['uksc-2015-11'], 'uksc'],
  ['cite-uksc-2021-50', '[2021] UKSC 50', ['uksc-2021-50'], 'uksc'],
  ['cite-uksc-2023-4', '[2023] UKSC 4', ['uksc-2023-4'], 'uksc'],
  ['cite-uksc-2010-42', '[2010] UKSC 42', ['uksc-2010-42'], 'uksc'],
  ['cite-uksc-2024-1', '[2024] UKSC 1', ['uksc-2024-1'], 'uksc'],
  ['cite-uksc-2024-3', '[2024] UKSC 3', ['uksc-2024-3'], 'uksc'],
  ['cite-uksc-2018-29', '[2018] UKSC 29', ['uksc-2018-29'], 'uksc'],
  ['cite-uksc-2016-42', '[2016] UKSC 42', ['uksc-2016-42'], 'uksc'],
  ['cite-uksc-2021-5', '[2021] UKSC 5', ['uksc-2021-5'], 'uksc'],
  ['cite-uksc-2021-1', '[2021] UKSC 1', ['uksc-2021-1'], 'uksc'],
  ['cite-uksc-2019-41', '[2019] UKSC 41', ['uksc-2019-41'], 'uksc'],
  ['cite-uksc-2022-21', '[2022] UKSC 21', ['uksc-2022-21'], 'uksc'],
  ['cite-ukpc-2021-3', '[2021] UKPC 3', ['ukpc-2021-3'], 'ukpc'],
  [
    'cite-ewca-civ-2020-1295',
    '[2020] EWCA Civ 1295',
    ['ewca-civ-2020-1295'],
    'ewca-civ',
  ],
])

const documentIdHeld = held('document_id', [
  ['id-uksc-2021-3', 'uksc-2021-3', ['uksc-2021-3'], 'uksc'],
  ['id-uksc-2022-27', 'uksc-2022-27', ['uksc-2022-27'], 'uksc'],
  ['id-uksc-2017-5', 'uksc-2017-5', ['uksc-2017-5'], 'uksc'],
  [
    'id-ewca-civ-2024-123',
    'ewca-civ-2024-123',
    ['ewca-civ-2024-123'],
    'ewca-civ',
  ],
  ['id-ukpc-2021-3', 'ukpc-2021-3', ['ukpc-2021-3'], 'ukpc'],
])

const absentCitations = absent([
  ['absent-ewca-civ-2023-123', '[2023] EWCA Civ 123', 'ewca-civ'],
  ['absent-ewca-civ-2021-9999', '[2021] EWCA Civ 9999', 'ewca-civ'],
  ['absent-ukhl-2003-1', '[2003] UKHL 1', 'ukhl'],
  ['absent-uksc-2024-999', '[2024] UKSC 999', 'uksc'],
  ['absent-ukpc-2019-99', '[2019] UKPC 99', 'ukpc'],
  ['absent-ewca-crim-2022-9999', '[2022] EWCA Crim 9999', 'ewca-crim'],
  ['absent-uksc-2020-99', '[2020] UKSC 99', 'uksc'],
  ['absent-ewca-civ-2018-1', '[2018] EWCA Civ 1', 'ewca-civ'],
  ['absent-ewca-civ-1999-9999', '[1999] EWCA Civ 9999', 'ewca-civ'],
  ['absent-ukpc-2015-1', '[2015] UKPC 1', 'ukpc'],
  ['absent-uksc-2012-99', '[2012] UKSC 99', 'uksc'],
  ['absent-uksc-2023-99', '[2023] UKSC 99', 'uksc'],
  ['absent-ewca-civ-2026-1', '[2026] EWCA Civ 1', 'ewca-civ'],
  ['absent-ewhc-admin-2021-9999', '[2021] EWHC 9999 (Admin)', 'ewhc'],
])

export const corpusRelevanceCases: CorpusRelevanceCase[] = [
  ...partyHeld,
  ...citationHeld,
  ...documentIdHeld,
  ...absentCitations,
]

export const corpusRelevanceTopK = 20
