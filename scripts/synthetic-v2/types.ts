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
export type HardNegativeKind =
  | 'neutral_citation'
  | 'claim_number'
  | 'damages_figure'
  | 'company_registration'

/** Exact, fictional counterexample required in immutable source text. */
export interface HardNegativeAssertion {
  id: string
  kind: HardNegativeKind
  quote: string
  /** One-based source occurrence. */
  occurrence: number
  /** Exact number of times the literal must occur in the source. */
  expectedCount: number
  /** Positive annotation categories which may never cover this assertion. */
  mustNotOverlap: SpanCategory[]
}

export interface DocumentSpec {
  id: string
  docType: DocumentType
  requiredCategories: SpanCategory[]
  register: Register
  difficulty: Difficulty
  lengthWords: number
  seed: string
  scenario: string
  hardNegatives: HardNegativeAssertion[]
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

export interface RequestTelemetry {
  requestId: string
  specId: string
  role: 'writer' | 'annotator' | 'primary_judge' | 'dispute_judge'
  requestedModel: string
  returnedModel?: string
  usage?: Usage
  latencyMs: number
  status: 'success' | 'error' | 'aborted'
  errorCode?: string
}

export interface GeneratedDocument {
  customId: string
  text: string
  generator: string
  usage: Usage
  telemetry?: RequestTelemetry
}

/** Model annotations reference immutable generated document text. */
export interface GeneratedAnnotation {
  customId: string
  spans: SyntheticSpan[]
  generator: string
  usage: Usage
  telemetry?: RequestTelemetry
}

export interface SyntheticDocument {
  id: string
  text: string
  spans: SyntheticSpan[]
  generator: string
  specCell: string
  matrixCells: string[]
  contentHash: string
  hardNegatives?: HardNegativeAssertion[]
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
    signal?: AbortSignal,
  ): Promise<GeneratedAnnotation[]>
  repair(
    inputs: LabelInput[],
    feedback: Map<string, string>,
    onProgress?: (progress: GenerationProgress) => void,
    signal?: AbortSignal,
  ): Promise<GeneratedAnnotation[]>
}

export interface GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts: number
  generate(
    specs: DocumentSpec[],
    onProgress?: (progress: GenerationProgress) => void,
    signal?: AbortSignal,
  ): Promise<GeneratedDocument[]>
}

export interface JudgeAdapter {
  readonly name: string
  judge(
    documents: SyntheticDocument[],
    signal?: AbortSignal,
  ): Promise<
    Array<{ id: string; verdict: string; telemetry?: RequestTelemetry }>
  >
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
