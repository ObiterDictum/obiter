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

/**
 * Stable identity persisted with generated documents. A specification can
 * require several category cells, so its identity must bind all of them.
 */
export function generationSpecIdentity(
  spec: Pick<DocumentSpec, 'matrixCells'>,
) {
  return [...spec.matrixCells].sort().join('||')
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
  requiredCategories: SpanCategory[],
): DocumentSpec['hardNegatives'] {
  if (difficulty !== 'hard_negative') return []
  const ordinal = Number(id.match(/(\d+)$/)?.[1] ?? 1)
  const noOverlap = [...spanCategories]
  const claimSequence = String(ordinal).padStart(6, '0')
  const companyNumber = String(10_000_000 + ordinal).slice(-8)
  const categoryAssertions = requiredCategories.map((category, index) => {
    const counterexample = categoryCounterexample(category, index)
    return {
      id: `${id}:${category}:counterexample`,
      ...counterexample,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    }
  })
  return [
    ...categoryAssertions,
    {
      id: `${id}:neutral-citation`,
      kind: 'neutral_citation',
      quote: `[2099] EWHC ${100 + (ordinal % 900)} (KB)`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
    {
      id: `${id}:claim-number`,
      kind: 'claim_number',
      quote: `Claim No. KB-2026-${claimSequence}`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
    {
      id: `${id}:damages-figure`,
      kind: 'damages_figure',
      quote: `£${(125_000 + ordinal).toLocaleString('en-GB')}`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
    {
      id: `${id}:company-registration`,
      kind: 'company_registration',
      quote: `Company No. ${companyNumber}`,
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: noOverlap,
    },
  ]
}

function categoryCounterexample(category: SpanCategory, index: number) {
  const role = ['the Claimant', 'the Respondent', 'the Applicant'][index % 3]!
  switch (category) {
    case 'person_private':
    case 'person_protected':
    case 'person_professional':
      return { kind: 'role_reference' as const, quote: role }
    case 'address':
      return {
        kind: 'court_address' as const,
        quote: 'Royal Courts of Justice',
      }
    case 'email':
    case 'phone':
      return {
        kind: 'court_contact' as const,
        quote:
          category === 'email'
            ? 'registrar@justice.gov.uk'
            : 'Royal Courts switchboard 020 7947 6000',
      }
    case 'date':
      return { kind: 'procedural_date' as const, quote: '12 March 2026' }
    default:
      return {
        kind: 'public_legal_reference' as const,
        quote: `CPR 31.6 paragraph ${index + 1}`,
      }
  }
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
        base.requiredCategories,
      ),
      matrixCells,
    }
  })
}

/**
 * A 24-document tournament cannot fill the full 816-cell benchmark matrix.
 * It instead deliberately covers every document type, register, difficulty,
 * and category group before candidate comparison.
 */
export function buildTournamentQuotaSpecs(total = 24, prefix = 'tournament') {
  if (total !== 24)
    throw new Error(
      'Tournament comparison requires the fixed 24-document specification set',
    )
  const all = buildQuotaSpecs(192, prefix)
  return Array.from({ length: total }, (_, index) => {
    const documentType = index % documentTypes.length
    const register = Math.floor(index / documentTypes.length) % registers.length
    const difficulty = (index + Math.floor(index / 4)) % difficulties.length
    const categoryGroup = index % categoryGroups.length
    const baseIndex =
      ((documentType * registers.length + register) * difficulties.length +
        difficulty) *
        categoryGroups.length +
      categoryGroup
    return all[baseIndex]!
  })
}

export function assertTournamentStratification(specs: DocumentSpec[]) {
  if (specs.length !== 24)
    throw new Error('Tournament must contain exactly 24 documents')
  const documentTypeCoverage = new Set(specs.map((spec) => spec.docType))
  const registerCoverage = new Set(specs.map((spec) => spec.register))
  const difficultyCoverage = new Set(specs.map((spec) => spec.difficulty))
  const categoryCoverage = new Set(
    specs.flatMap((spec) => spec.requiredCategories),
  )
  if (
    documentTypeCoverage.size !== documentTypes.length ||
    registerCoverage.size !== registers.length ||
    difficultyCoverage.size !== difficulties.length ||
    categoryCoverage.size !== spanCategories.length
  )
    throw new Error(
      'Tournament specifications are not stratified across required dimensions',
    )
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
