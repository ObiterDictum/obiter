import { z } from 'zod'

const timestampSchema = z.string().datetime({ offset: true })
const idSchema = z.string().min(1)

export const AGENT_GOAL_MAX_LENGTH = 2000

export const agentToolIdSchema = z.enum([
  'search_corpus',
  'get_paragraph',
  'matter_documents',
  'read_document_version',
])
export type AgentToolId = z.infer<typeof agentToolIdSchema>

export const agentRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
  'refused',
])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const agentFailureReasonSchema = z.enum([
  'weak_evidence',
  'model_unavailable',
  'system_error',
])
export type AgentFailureReason = z.infer<typeof agentFailureReasonSchema>

export const agentRefusalReasonSchema = z.enum([
  'policy_blocked',
  'permission_denied',
  'missing_context',
  'over_budget',
])
export type AgentRefusalReason = z.infer<typeof agentRefusalReasonSchema>

export const agentStopReasonSchema = z.enum([
  'completed',
  'user_cancelled',
  ...agentFailureReasonSchema.options,
  ...agentRefusalReasonSchema.options,
])
export type AgentStopReason = z.infer<typeof agentStopReasonSchema>

export const agentRefusalCodeSchema = z.enum([
  'policy_blocked',
  'permission_denied',
  'wall_blocked',
  'cap_blocked',
])
export type AgentRefusalCode = z.infer<typeof agentRefusalCodeSchema>

export const agentMissingItemSchema = z
  .object({
    kind: z.enum(['setting', 'context', 'permission']),
    id: idSchema,
    label: z.string().min(1),
  })
  .strict()
export type AgentMissingItem = z.infer<typeof agentMissingItemSchema>

export const agentRefusalSchema = z
  .object({
    code: agentRefusalCodeSchema,
    ruleId: idSchema,
    message: z.string().min(1),
    missing: agentMissingItemSchema.nullable(),
  })
  .strict()
export type AgentRefusal = z.infer<typeof agentRefusalSchema>

export const agentRunBudgetSchema = z
  .object({
    currency: z.literal('USD'),
    tokenCap: z.number().int().positive(),
    costCapMicros: z.number().int().positive(),
    tokensReserved: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative(),
    costReservedMicros: z.number().int().nonnegative(),
    costUsedMicros: z.number().int().nonnegative(),
  })
  .strict()
export type AgentRunBudget = z.infer<typeof agentRunBudgetSchema>

export const agentModelIdentitySchema = z
  .object({
    provider: idSchema,
    modelId: idSchema,
    snapshot: idSchema,
  })
  .strict()
export type AgentModelIdentity = z.infer<typeof agentModelIdentitySchema>

export const agentRunVersionsSchema = z
  .object({
    agent: idSchema,
    prompt: idSchema,
    toolRegistry: idSchema,
    trace: idSchema,
    rateCard: idSchema,
    model: agentModelIdentitySchema,
  })
  .strict()
export type AgentRunVersions = z.infer<typeof agentRunVersionsSchema>

export const agentEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('corpus_paragraph'),
      evidenceId: idSchema,
      authorityId: idSchema,
      title: z.string().min(1),
      neutralCitation: z.string().min(1).nullable(),
      paragraphNumber: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('document_span'),
      evidenceId: idSchema,
      documentId: idSchema,
      versionId: idSchema,
      documentName: z.string().min(1),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      excerpt: z.string().min(1),
    })
    .strict(),
])
export type AgentEvidence = z.infer<typeof agentEvidenceSchema>

export const agentAnswerSentenceSchema = z
  .object({
    text: z.string().min(1),
    evidenceIds: z.array(idSchema).min(1),
  })
  .strict()
export type AgentAnswerSentence = z.infer<typeof agentAnswerSentenceSchema>

export const agentAnswerSchema = z
  .object({
    sentences: z.array(agentAnswerSentenceSchema).min(1),
    evidence: z.array(agentEvidenceSchema).min(1),
    droppedSentenceCount: z.number().int().nonnegative(),
  })
  .strict()
export type AgentAnswer = z.infer<typeof agentAnswerSchema>

const agentRunBaseSchema = z
  .object({
    id: idSchema,
    organisationId: idSchema,
    matterId: idSchema,
    createdBy: idSchema,
    goal: z.string().min(1).max(AGENT_GOAL_MAX_LENGTH),
    context: z
      .object({
        documentId: idSchema.nullable(),
        versionId: idSchema.nullable(),
      })
      .strict(),
    matterText: z.object({ allowed: z.boolean(), sent: z.boolean() }).strict(),
    toolAllowList: z.array(agentToolIdSchema),
    versions: agentRunVersionsSchema,
    budget: agentRunBudgetSchema,
    stepCount: z.number().int().nonnegative(),
    sourcesRead: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable(),
  })
  .strict()

export const agentRunSchema = z.discriminatedUnion('status', [
  agentRunBaseSchema.extend({
    status: z.enum(['queued', 'running', 'waiting_for_approval']),
    stopReason: z.null(),
  }),
  agentRunBaseSchema.extend({
    status: z.literal('completed'),
    stopReason: z.literal('completed'),
    answer: agentAnswerSchema,
  }),
  agentRunBaseSchema.extend({
    status: z.literal('failed'),
    stopReason: agentFailureReasonSchema,
    message: z.string().min(1),
  }),
  agentRunBaseSchema.extend({
    status: z.literal('cancelled'),
    stopReason: z.literal('user_cancelled'),
  }),
  agentRunBaseSchema.extend({
    status: z.literal('refused'),
    stopReason: agentRefusalReasonSchema,
    refusal: agentRefusalSchema,
  }),
])
export type AgentRun = z.infer<typeof agentRunSchema>

export function isAgentRunLive(run: Pick<AgentRun, 'status'>): boolean {
  return (
    run.status === 'queued' ||
    run.status === 'running' ||
    run.status === 'waiting_for_approval'
  )
}

export const agentStepSchema = z
  .object({
    index: z.number().int().positive(),
    kind: z.enum(['model', 'tool']),
    tool: agentToolIdSchema.nullable(),
    status: z.enum(['running', 'ok', 'error', 'refused']),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
  })
  .strict()
export type AgentStep = z.infer<typeof agentStepSchema>

export const agentToolErrorCodeSchema = z.enum([
  'invalid_args',
  'not_found',
  'permission_denied',
  'wall_blocked',
  'cap_exceeded',
  'system_error',
])
export type AgentToolErrorCode = z.infer<typeof agentToolErrorCodeSchema>

export const agentToolCallSchema = z
  .object({
    id: idSchema,
    runId: idSchema,
    step: z.number().int().positive(),
    tool: agentToolIdSchema,
    toolVersion: idSchema,
    matterId: idSchema,
    idempotencyKey: idSchema,
    argsHash: idSchema,
    status: z.enum(['ok', 'error']),
    errorCode: agentToolErrorCodeSchema.nullable(),
    evidenceIds: z.array(idSchema),
    contentHash: idSchema.nullable(),
    truncated: z.boolean(),
    latencyMs: z.number().int().nonnegative(),
  })
  .strict()
export type AgentToolCall = z.infer<typeof agentToolCallSchema>
