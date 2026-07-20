import {
  documentTypes,
  spanCategories,
  type Difficulty,
  type DocumentSpec,
  type Register,
  type SpanCategory,
} from './types'

const registers: Register[] = [
  'formal_pleading',
  'solicitor_correspondence',
  'internal_note',
]
const difficulties: Difficulty[] = ['standard', 'hard_negative']
const categoryGroups: SpanCategory[][] = [
  [
    'person_private',
    'person_protected',
    'person_professional',
    'address',
    'email',
  ],
  ['phone', 'date', 'national_insurance', 'account_number', 'passport'],
  ['government_id', 'drivers_license', 'organisation_name', 'case_reference'],
  ['url', 'ip_address', 'secret'],
]

export function matrixCell(
  docType: string,
  category: string,
  register: string,
  difficulty: string,
) {
  return `${docType}|${category}|${register}|${difficulty}`
}

function scenarioFor(index: number) {
  const matters = [
    'a disputed service-charge demand following remedial roof works',
    'an employment grievance about a revised commission arrangement',
    'a tenancy dispute concerning an allegedly unlawful lock change',
    'a consumer claim for defective professional services',
    'a contractual dispute about delayed software implementation',
    'a boundary dispute following drainage works',
    'a probate-administration disagreement concerning an estate account',
    'a partnership dispute about client-file handover',
  ]
  const regions = [
    'Birmingham',
    'Cardiff',
    'Leeds',
    'Belfast',
    'Glasgow',
    'Bristol',
    'Manchester',
    'Newcastle',
  ]
  return `Matter ${index + 1}: ${matters[index % matters.length]} in ${regions[index % regions.length]}.`
}

function hardNegatives(
  difficulty: Difficulty,
  id: string,
): DocumentSpec['hardNegatives'] {
  if (difficulty !== 'hard_negative') return []
  const token = id.toUpperCase().replaceAll('-', '')
  const noOverlap = [...spanCategories]
  return [
    {
      id: `${id}:neutral-citation`,
      kind: 'neutral_citation',
      quote: `[2099] EWHC ${token.slice(-4)} (KB)`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
    {
      id: `${id}:claim-number`,
      kind: 'claim_number',
      quote: `Claim No. ${token.slice(-8)}/CIV`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
    {
      id: `${id}:damages-figure`,
      kind: 'damages_figure',
      quote: `£${String(100000 + Number(token.slice(-3) || 0)).slice(-6)}`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
    {
      id: `${id}:company-registration`,
      kind: 'company_registration',
      quote: `Company No. ${token.slice(-8)}`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
  ]
}

/**
 * Each specification covers five category cells. This allows the 280-document
 * benchmark to fill every 8 × 15 × 3 × 2 matrix cell at least once.
 */
export function buildQuotaSpecs(total: number, prefix: string): DocumentSpec[] {
  if (!Number.isInteger(total) || total < 1)
    throw new Error('Document total must be a positive integer')

  const bases = documentTypes.flatMap((docType) =>
    registers.flatMap((register) =>
      difficulties.flatMap((difficulty) =>
        categoryGroups.map((requiredCategories) => ({
          docType,
          register,
          difficulty,
          requiredCategories,
        })),
      ),
    ),
  )

  return Array.from({ length: total }, (_, index) => {
    const base = bases[index % bases.length]!
    const matrixCells = base.requiredCategories.map((category) =>
      matrixCell(base.docType, category, base.register, base.difficulty),
    )
    return {
      id: `${prefix}-${String(index + 1).padStart(5, '0')}`,
      docType: base.docType,
      requiredCategories: [...base.requiredCategories],
      register: base.register,
      difficulty: base.difficulty,
      lengthWords: base.difficulty === 'hard_negative' ? 850 : 650,
      seed: `${prefix}:${index + 1}:${base.docType}:${base.register}:${base.difficulty}`,
      scenario: scenarioFor(index),
      hardNegatives: hardNegatives(
        base.difficulty,
        `${prefix}-${String(index + 1).padStart(5, '0')}`,
      ),
      matrixCells,
    }
  })
}

export function expectedMatrixCells() {
  return documentTypes.flatMap((docType) =>
    spanCategories.flatMap((category) =>
      registers.flatMap((register) =>
        difficulties.map((difficulty) =>
          matrixCell(docType, category, register, difficulty),
        ),
      ),
    ),
  )
}
