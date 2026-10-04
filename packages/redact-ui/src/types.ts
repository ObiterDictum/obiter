import type {
  DetectionMode,
  DocumentTextLayout,
  DocumentTextLayoutSegment,
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
  outputArtifactId: string | null
  detectorVersion: string | null
  detectionMode: DetectionMode
  replacesRunId: string | null
  replacementRunId: string | null
  createdAt: string
  updatedAt: string
}

export type { DocumentTextLayout, DocumentTextLayoutSegment }

export interface RedetectResponse {
  run: RedactionRun
  redetectedFromRunId: string
}

export interface FinalizeResponse {
  run: RedactionRun
  artifact: { id: string; objectKey: string; artifactType: 'redaction_output' }
  warnings: {
    unreviewedSpanIds: string[]
    coverageUnchecked?: boolean
    outputDowngrade?: RunSummary['outputDowngrade']
  }
}

/**
 * Metadata for a finalized redaction artifact. Bytes are fetched once from
 * `/output/file` and used for preview, download and share alike. Shared with
 * the API response contract rather than duplicated here.
 */
export type RedactionOutput = RedactionOutputResponse

export interface SpanDecisionInput {
  spanId: string
  decision: SpanDecision
}
export type FinalizeInput = RedactionFinalizeInput
