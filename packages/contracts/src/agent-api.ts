import { z } from 'zod'
import {
  AGENT_GOAL_MAX_LENGTH,
  agentRunSchema,
  agentStepSchema,
  agentToolCallSchema,
} from './agent-run'
import { agentTraceEventSchema } from './agent-trace'

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
