import type {
  SpanCategory,
  SpanConfidence,
  SpanDecision,
  SpanSource,
  SpanSuggestion,
} from '@obiter/contracts'

export type {
  SpanCategory,
  SpanConfidence,
  SpanDecision,
  SpanSource,
  SpanSuggestion,
}

export interface RedactionSpan {
  id: string
  start: number
  end: number
  text: string
  category: SpanCategory
  source: SpanSource
  confidence: SpanConfidence
  suggestion: SpanSuggestion
}

export type DecisionRecord = {
  decision: SpanDecision
  decidedBy: string
  decidedAt: string
  decidedByName?: string | null
}

export type Decisions = Record<string, DecisionRecord>

export type OutputDowngradeReason =
  'tracked_change' | 'residual_text' | 'burn_failed'

export interface RunSummary {
  totalSpans: number
  byCategory: Record<SpanCategory, number>
  bySource: {
    rampartModel: number
    rampartDeterministic: number
    ukSupplement: number
  }
  byDecision?: Record<SpanDecision | 'undecided', number>
  reviewedCount: number
  unreviewedCount: number
  failureReason?: string
  outputMode?: 'redacted' | 'pseudonymised'
  outputMimeType?: string
  outputFilename?: string | null
  outputDowngrade?: {
    from: 'pdf' | 'docx'
    reason: OutputDowngradeReason
  } | null
  outputSha256?: string
  securePdf?: boolean
}
