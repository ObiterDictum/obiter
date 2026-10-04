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

export type Decisions = Record<
  string,
  { decision: SpanDecision; decidedBy: string; decidedAt: string }
>

/**
 * Why a finalized run downgraded to text instead of the burned container
 * (PDF/.docx). Reason codes only — never span text or filenames. Persisted
 * in summary_json so the warning survives a page reload.
 */
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
  /** SHA-256 of the stored finalized artifact bytes, hex encoded. */
  outputSha256?: string
  /**
   * True only for a hard-redaction PDF produced by the secure rasterized path.
   * Absent or false on legacy hard-redaction DOCX/TXT artifacts and on
   * pseudonymised output.
   */
  securePdf?: boolean
}
