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
  /** The deciding person's member name, added when the API reads a run so a
   * reviewer reads a colleague's name rather than an internal id. It is never
   * stored: `decisions_json` keeps only the id the decision was made under. */
  decidedByName?: string | null
}

export type Decisions = Record<string, DecisionRecord>

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
  /** SHA-256 of the stored finalized output bytes, hex encoded. */
  outputSha256?: string
  /**
   * True only for a hard-redaction PDF produced by the secure rasterized path.
   * Absent or false on legacy hard-redaction DOCX/TXT outputs and on
   * pseudonymised output.
   */
  securePdf?: boolean
}
