import type {
  SpanCategory,
  SpanConfidence,
  SpanDecision,
  SpanSource,
  SpanSuggestion,
} from '@obiter/contracts'

export type { SpanCategory, SpanConfidence, SpanDecision, SpanSource, SpanSuggestion }

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

export type Decisions = Record<
  string,
  { decision: SpanDecision; decidedBy: string; decidedAt: string }
>

export interface RunSummary {
  totalSpans: number
  byCategory: Record<SpanCategory, number>
  bySource: {
    rampartModel: number
    rampartDeterministic: number
    ukSupplement: number
  }
  reviewedCount: number
  unreviewedCount: number
  failureReason?: string
}
