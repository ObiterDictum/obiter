import type {
  DetectionMode,
  DocumentTextLayout,
  RedactionFinalizeInput,
  RedactionOutputResponse,
  RedactionPolicyMode,
  RedactionRunStatus,
  SpanDecision,
} from '@obiter/contracts'
import type {
  Decisions,
  RedactionSpan,
  RunSummary,
} from '@obiter/redaction-policy'

export interface RedactionRun {
  id: string
  matterId: string | null
  matterName: string | null
  documentId: string | null
  documentVersionId: string | null
  sourceFilename: string
  sourceMimeType?: string | null
  sourcePreview?: {
    kind: 'pdf' | 'text'
    available: boolean
  }
  status: RedactionRunStatus
  policyMode: RedactionPolicyMode
  spans: RedactionSpan[]
  decisions: Decisions
  summary: RunSummary
  outputId: string | null
  detectorVersion: string | null
  detectionMode: DetectionMode
  replacesRunId: string | null
  replacementRunId: string | null
  /**
   * Document version this run's finalized output became (E12 return, or a
   * standalone run saved to a matter). Present only after it succeeded.
   */
  returnedDocumentVersionId?: string | null
  /** Where that version lives, so the copy can be opened after it is filed. */
  returnedMatterId?: string | null
  returnedDocumentId?: string | null
  returnedDocumentVersionNumber?: number | null
  createdAt: string
  updatedAt: string
}

export type { DocumentTextLayout }

export interface RedetectResponse {
  run: RedactionRun
  redetectedFromRunId: string
}

export interface FinalizeResponse {
  run: RedactionRun
  output: { id: string; objectKey: string; outputType: 'redaction_output' }
  warnings: {
    unreviewedSpanIds: string[]
    coverageUnchecked?: boolean
    outputDowngrade?: RunSummary['outputDowngrade']
  }
}

/**
 * Metadata for a finalized redaction output. Bytes are fetched once from
 * `/output/file` and used for preview, download and share alike. Shared with
 * the API response contract rather than duplicated here.
 */
export type RedactionOutput = RedactionOutputResponse

export interface SpanDecisionInput {
  spanId: string
  decision: SpanDecision
  /** Repeat the decision on every span reading the same text in this run. */
  applyToSameText?: boolean
}
export type FinalizeInput = RedactionFinalizeInput
