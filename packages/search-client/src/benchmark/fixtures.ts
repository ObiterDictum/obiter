import type { LegalSearchDocument } from '../index'

function judgment(
  id: string,
  title: string,
  neutralCitation: string | null,
  court: string,
  jurisdiction: string,
  dateDecided: string,
  paragraphs: string[],
): LegalSearchDocument {
  return {
    id,
    title,
    neutralCitation,
    court,
    jurisdiction,
    dateDecided,
    sourceType: 'judgment',
    sourceUrl: `https://example.test/judgments/${id}`,
    paragraphs: paragraphs.map((text, index) => ({
      id: `${id}-p${index + 1}`,
      documentId: id,
      paragraphNumber: index + 1,
      text,
    })),
  }
}

const objectiveDocuments = [
  judgment(
    'uksc-2024-3',
    'Potanina v Potanin',
    '[2024] UKSC 3',
    'uksc',
    'united-kingdom',
    '2024-01-31',
    [
      'The application for permission to bring proceedings under Part III was allowed.',
      'The judgment addressed financial remedy jurisdiction after an overseas divorce.',
    ],
  ),
  judgment(
    'uksc-2023-28',
    'Paul v Royal Wolverhampton NHS Trust',
    '[2023] UKSC 28',
    'uksc',
    'united-kingdom',
    '2023-12-19',
    [
      'The court considered material contribution to an indivisible injury.',
      'The appeal concerned the limits of recovery for psychiatric harm.',
    ],
  ),
  judgment(
    'ewca-civ-2022-159',
    'Rizwan v Secretary of State for the Home Department',
    '[2022] EWCA Civ 159',
    'ewca-civ',
    'england-and-wales',
    '2022-02-18',
    ['Procedural fairness required disclosure of the decisive material.'],
  ),
  judgment(
    'ewhc-admin-2021-123',
    'Green v Secretary of State for Justice',
    '[2021] EWHC 123 (Admin)',
    'ewhc-admin',
    'england-and-wales',
    '2021-01-22',
    ['The duty of candour applied throughout the judicial review claim.'],
  ),
  judgment(
    'ukut-aac-2020-99',
    'Dale v Department for Work and Pensions',
    '[2020] UKUT 99 (AAC)',
    'ukut-aac',
    'united-kingdom',
    '2020-04-03',
    ['The statutory appeal concerned entitlement to a mobility payment.'],
  ),
  judgment(
    'ewhc-ch-2019-77',
    'José Álvarez v Société Générale',
    '[2019] EWHC 77 (Ch)',
    'ewhc-ch',
    'england-and-wales',
    '2019-03-14',
    ['José Álvarez challenged the enforcement of the guarantee.'],
  ),
  judgment(
    'ewhc-ch-2018-88',
    'Müller v König GmbH',
    '[2018] EWHC 88 (Ch)',
    'ewhc-ch',
    'england-and-wales',
    '2018-04-20',
    ['The foreign judgment recognition issue turned on notice.'],
  ),
  judgment(
    'ewhc-kb-2020-10',
    'Smith v Jones',
    '[2020] EWHC 10 (KB)',
    'ewhc-kb',
    'england-and-wales',
    '2020-01-10',
    ['The dispute concerned a landlord covenant and repair costs.'],
  ),
  judgment(
    'ewhc-kb-2018-20',
    'Smith v Jones',
    '[2018] EWHC 20 (KB)',
    'ewhc-kb',
    'england-and-wales',
    '2018-02-12',
    ['The dispute concerned an employment bonus and notice pay.'],
  ),
  judgment(
    'ewfc-2022-1',
    'Re A (A Child)',
    '[2022] EWFC 1',
    'ewfc',
    'england-and-wales',
    '2022-01-05',
    ['The welfare analysis concerned contact arrangements.'],
  ),
  judgment(
    'ewca-civ-2021-2',
    'Re A (Capacity)',
    '[2021] EWCA Civ 2',
    'ewca-civ',
    'england-and-wales',
    '2021-01-06',
    ['The decision considered capacity to conduct proceedings.'],
  ),
  judgment(
    'ewca-crim-1993-1',
    'R v Brown',
    '[1993] EWCA Crim 1',
    'ewca-crim',
    'england-and-wales',
    '1993-03-11',
    ['The criminal appeal addressed consent and bodily harm.'],
  ),
  judgment(
    'ewca-crim-1994-2',
    'R v Brown',
    '[1994] EWCA Crim 2',
    'ewca-crim',
    'england-and-wales',
    '1994-06-17',
    ['The later criminal appeal concerned identification evidence.'],
  ),
  judgment(
    'ewca-crim-2024-44',
    'Crown v North',
    '[2024] EWCA Crim 44',
    'ewca-crim',
    'england-and-wales',
    '2024-05-09',
    [
      'The privilege against self-incrimination protected the interview answer.',
    ],
  ),
  judgment(
    'ewhc-ch-2017-55',
    'Wilson Estate v Hart',
    '[2017] EWHC 55 (Ch)',
    'ewhc-ch',
    'england-and-wales',
    '2017-02-03',
    ['The proprietary estoppel claim depended on a clear assurance.'],
  ),
  judgment(
    'ewhc-kb-2016-42',
    'Benchmark Application Decision',
    '[2016] EWHC 42 (KB)',
    'ewhc-kb',
    'england-and-wales',
    '2016-07-01',
    [
      'The court dismissed the claimant application in this judgment and refused the appeal.',
      'A satellite issue concerned costs only.',
    ],
  ),
  // Re-ranking decoys: the document id carries a party token, but nothing
  // else does. The engine's attribute rule prefers the id-field match, so a
  // party-name query ranks the decoy above the judgment whose title holds the
  // name; only the exact-match tier re-rank restores the right document.
  // Deleting that stage flips party-potanina and party-paul to top_1_miss.
  judgment(
    'potanina-costs-2025-1',
    'Costs assessment after overseas divorce',
    null,
    'ewhc-ch',
    'england-and-wales',
    '2025-04-07',
    [
      'The court assessed costs on the standard basis after overseas divorce proceedings.',
    ],
  ),
  judgment(
    'paul-costs-2025-1',
    'Costs assessment after ancillary relief',
    null,
    'ewhc-ch',
    'england-and-wales',
    '2025-05-06',
    [
      'The court assessed costs on the standard basis after ancillary relief proceedings.',
    ],
  ),
]

export const shortWordFixtures = [
  ['test', 'testimony', "testator's", 'testamentary', 'testing'],
  ['bail', 'bailiff', 'bailment', 'bailable', 'bailout'],
  ['tort', 'tortious', 'tortfeasor', 'torts', 'tortiously'],
  ['oath', 'oaths', 'oathbreaking', 'oathbound', 'oathkeeper'],
  ['writ', 'writing', 'written', 'writs', 'writedown'],
  ['deed', 'deeds', 'deeded', 'deedless', 'deedholder'],
  ['lien', 'liens', 'lienholder', 'lienable', 'lienor'],
  ['plea', 'pleading', 'pleas', 'pleaded', 'pleader'],
  ['jury', 'juryman', 'jurybox', 'jurylike', 'jurywoman'],
  ['fine', 'finery', 'fined', 'fines', 'finest'],
] as const

export function shortWordExpectedId(term: string) {
  const groupIndex = shortWordFixtures.findIndex(([value]) => value === term)
  if (groupIndex < 0) throw new Error(`Unknown short-word fixture: ${term}`)
  return `benchmark-short-${groupIndex + 1}-target`
}

const shortWordDocuments = shortWordFixtures.flatMap(
  ([term, ...prefixes], groupIndex) =>
    [term, ...prefixes].map((word, wordIndex) =>
      judgment(
        wordIndex === 0
          ? shortWordExpectedId(term)
          : `benchmark-short-${groupIndex + 1}-decoy-${wordIndex}`,
        `${wordIndex === 0 ? 'Short-word target' : 'Prefix distractor'} ${groupIndex + 1}-${wordIndex + 1}`,
        null,
        'benchmark-short-words',
        'benchmark',
        `2015-${String(groupIndex + 1).padStart(2, '0')}-${String(wordIndex + 1).padStart(2, '0')}`,
        [
          wordIndex === 0
            ? `The synthetic record uses ${term} as a complete word.`
            : `The synthetic record contains ${word} but not the complete query word.`,
        ],
      ),
    ),
)

export const searchBenchmarkDocuments: LegalSearchDocument[] = [
  ...objectiveDocuments,
  ...shortWordDocuments,
]
