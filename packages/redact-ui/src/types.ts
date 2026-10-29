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
  returnedDocumentVersionId?: string | null
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

export type RedactionOutput = RedactionOutputResponse

export interface SpanDecisionInput {
  spanId: string
  decision: SpanDecision
  applyToSameText?: boolean
}
export type FinalizeInput = RedactionFinalizeInput
