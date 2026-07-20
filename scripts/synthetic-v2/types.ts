export const spanCategories = [
  'person_private',
  'person_protected',
  'person_professional',
  'email',
  'phone',
  'address',
  'date',
  'government_id',
  'account_number',
  'passport',
  'drivers_license',
  'url',
  'ip_address',
  'national_insurance',
  'case_reference',
  'organisation_name',
  'secret',
] as const

export type SpanCategory = (typeof spanCategories)[number]

export const documentTypes = [
  'witness_statement',
  'particulars_of_claim',
  'skeleton_argument',
  'attendance_note',
  'letter_before_action',
  'dispute_correspondence',
  'contract_clause',
  'court_order',
] as const

export type DocumentType = (typeof documentTypes)[number]
export type Register =
  'formal_pleading' | 'solicitor_correspondence' | 'internal_note'
export type Difficulty = 'standard' | 'hard_negative'

export interface DocumentSpec {
  id: string
  docType: DocumentType
  requiredCategories: SpanCategory[]
  register: Register
  difficulty: Difficulty
  lengthWords: number
  seed: string
  scenario: string
  hardNegatives: string[]
  matrixCells: string[]
}

export interface SyntheticSpan {
  category: SpanCategory
  start: number
  end: number
  text: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

export interface GeneratedDocument {
  customId: string
  text: string
  generator: string
  usage: Usage
}

/** Model annotations reference the immutable generated document text. */
export interface GeneratedAnnotation {
  customId: string
  spans: SyntheticSpan[]
  generator: string
  usage: Usage
}

export interface SyntheticDocument {
  id: string
  text: string
  spans: SyntheticSpan[]
  generator: string
  specCell: string
  matrixCells: string[]
  contentHash: string
}

export interface GenerationProgress {
  phase: 'submitted' | 'completed' | 'retrying'
  completed: number
  total: number
  specId?: string
  attempt?: number
  reason?: string
}

export interface LabelInput {
  spec: DocumentSpec
  text: string
}

export interface LabelingAdapter {
  readonly name: string
  readonly maxChargeAttempts: number
  label(
    inputs: LabelInput[],
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedAnnotation[]>
  repair(
    inputs: LabelInput[],
    feedback: Map<string, string>,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedAnnotation[]>
}

export interface GeneratorAdapter {
  readonly name: string
  /** Maximum billable attempts per request, including the initial attempt. */
  readonly maxChargeAttempts: number
  generate(
    specs: DocumentSpec[],
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedDocument[]>
}

export interface SpendEntry {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  gbp: number
  recordedAt: string
  state: 'reserved' | 'actual'
  reservationId?: string
}

export interface SpendLedger {
  capGbp: number
  entries: SpendEntry[]
}
