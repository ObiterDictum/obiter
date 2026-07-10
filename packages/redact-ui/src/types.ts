import type { OutputMode, RedactionPolicyMode, RedactionRunStatus, SpanDecision } from '@obiter/contracts'
import type { Decisions, RedactionSpan, RunSummary } from '@obiter/redaction-policy'

export interface RedactionRun {
  id: string
  matterId: string | null
  matterName: string | null
  documentId: string | null
  documentVersionId: string | null
  sourceFilename: string
  status: RedactionRunStatus
  policyMode: RedactionPolicyMode
  spans: RedactionSpan[]
  decisions: Decisions
  summary: RunSummary
  outputArtifactId: string | null
  detectorVersion: string | null
  createdAt: string
  updatedAt: string
}

export interface FinalizeResponse {
  run: RedactionRun
  artifact: { id: string; objectKey: string; artifactType: 'redaction_output' }
  warnings: { unreviewedSpanIds: string[] }
}

export interface SpanDecisionInput { spanId: string; decision: SpanDecision }
export interface FinalizeInput { outputMode: OutputMode }
