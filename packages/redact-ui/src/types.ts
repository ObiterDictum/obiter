import type {
  DetectionMode,
  RedactionFinalizeInput,
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

export interface DocumentTextLayoutSegment {
  start: number
  end: number
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  ascent?: number
  descent?: number
  /** Exact per-character advances across the run, when extraction had them. */
  advances?: number[]
}

export interface DocumentTextLayout {
  version: 1
  pages: Array<{ width: number; height: number }>
  segments: DocumentTextLayoutSegment[]
}

export interface RedetectResponse {
  run: RedactionRun
  redetectedFromRunId: string
}

export interface FinalizeResponse {
  run: RedactionRun
  artifact: { id: string; objectKey: string; artifactType: 'redaction_output' }
  warnings: { unreviewedSpanIds: string[] }
}

export interface SpanDecisionInput {
  spanId: string
  decision: SpanDecision
}
export type FinalizeInput = RedactionFinalizeInput
