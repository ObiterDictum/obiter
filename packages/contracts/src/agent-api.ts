import { z } from 'zod'
import {
  AGENT_GOAL_MAX_LENGTH,
  agentRunSchema,
  agentSessionModeSchema,
  agentSessionSchema,
  agentSessionRunSchema,
  pendingApprovalSummarySchema,
  agentStepSchema,
  agentToolCallSchema,
} from './agent-run'
import {
  agentSessionTraceEventSchema,
  agentTraceEventSchema,
} from './agent-trace'
import { memorySuggestionSchema } from './agent-memory'

export const agentRunCreateRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(AGENT_GOAL_MAX_LENGTH),
    documentId: z.string().min(1).optional(),
    versionId: z.string().min(1).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .refine((request) => !request.versionId || request.documentId, {
    message: 'A version needs its document.',
    path: ['versionId'],
  })
export type AgentRunCreateRequest = z.infer<typeof agentRunCreateRequestSchema>

export const agentRunResponseSchema = z.object({ run: agentRunSchema }).strict()
export type AgentRunResponse = z.infer<typeof agentRunResponseSchema>

export const agentRunDetailResponseSchema = z
  .object({
    run: agentRunSchema,
    steps: z.array(agentStepSchema),
    toolCalls: z.array(agentToolCallSchema),
    events: z.array(agentTraceEventSchema),
  })
  .strict()
export type AgentRunDetailResponse = z.infer<
  typeof agentRunDetailResponseSchema
>

export const agentRunListResponseSchema = z
  .object({ runs: z.array(agentRunSchema) })
  .strict()
export type AgentRunListResponse = z.infer<typeof agentRunListResponseSchema>

export const agentRunStreamMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: agentTraceEventSchema }).strict(),
  z.object({ type: z.literal('run'), run: agentRunSchema }).strict(),
])
export type AgentRunStreamMessage = z.infer<typeof agentRunStreamMessageSchema>

const sessionIdSchema = z.string().min(1)
const idempotencyKeySchema = z.string().uuid()
export const agentSessionListResponseSchema = z
  .object({ sessions: z.array(agentSessionSchema) })
  .strict()
export type AgentSessionListResponse = z.infer<
  typeof agentSessionListResponseSchema
>
export const agentSessionCreateRequestSchema = z
  .object({
    matterId: sessionIdSchema.nullable(),
    title: z.string().trim().min(1),
    mode: agentSessionModeSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
export type AgentSessionCreateRequest = z.infer<
  typeof agentSessionCreateRequestSchema
>
export const agentSessionResponseSchema = z
  .object({ session: agentSessionSchema })
  .strict()
export type AgentSessionResponse = z.infer<typeof agentSessionResponseSchema>
export const agentSessionDetailResponseSchema = z
  .object({ session: agentSessionSchema, runs: z.array(agentSessionRunSchema) })
  .strict()
export type AgentSessionDetailResponse = z.infer<
  typeof agentSessionDetailResponseSchema
>
export const agentSessionTurnRequestSchema = z
  .object({
    kind: z.enum(['follow_up', 'steer']),
    text: z.string().trim().min(1).max(AGENT_GOAL_MAX_LENGTH),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
export type AgentSessionTurnRequest = z.infer<
  typeof agentSessionTurnRequestSchema
>
export const agentSessionTurnResponseSchema = z
  .object({ run: agentSessionRunSchema })
  .strict()
export type AgentSessionTurnResponse = z.infer<
  typeof agentSessionTurnResponseSchema
>
export const agentSessionAttachMatterRequestSchema = z
  .object({ matterId: sessionIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict()
export type AgentSessionAttachMatterRequest = z.infer<
  typeof agentSessionAttachMatterRequestSchema
>
export const agentSessionAttachMatterResponseSchema = agentSessionResponseSchema
export type AgentSessionAttachMatterResponse = z.infer<
  typeof agentSessionAttachMatterResponseSchema
>
export const agentApprovalDecisionRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    idempotencyKey: idempotencyKeySchema,
    expectedPayloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export type AgentApprovalDecisionRequest = z.infer<
  typeof agentApprovalDecisionRequestSchema
>
export const agentApprovalDecisionResponseSchema = z
  .object({
    approvalId: sessionIdSchema,
    status: z.enum(['approved', 'rejected']),
  })
  .strict()
export type AgentApprovalDecisionResponse = z.infer<
  typeof agentApprovalDecisionResponseSchema
>

const streamBase = { seq: z.number().int().positive(), runId: sessionIdSchema }
export const agentSessionStreamMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...streamBase,
      type: z.literal('text_delta'),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...streamBase,
      type: z.literal('memory_suggestion'),
      suggestion: memorySuggestionSchema,
    })
    .strict(),
  z
    .object({
      ...streamBase,
      type: z.literal('approval_requested'),
      approval: pendingApprovalSummarySchema,
    })
    .strict(),
  z
    .object({
      ...streamBase,
      type: z.literal('approval_resolved'),
      approvalId: sessionIdSchema,
      status: z.enum(['approved', 'rejected', 'expired', 'invalidated']),
    })
    .strict(),
  z
    .object({
      ...streamBase,
      type: z.literal('run'),
      run: agentSessionRunSchema,
    })
    .strict(),
  z
    .object({
      ...streamBase,
      type: z.literal('trace'),
      event: agentSessionTraceEventSchema,
    })
    .strict(),
])
export type AgentSessionStreamMessage = z.infer<
  typeof agentSessionStreamMessageSchema
>
