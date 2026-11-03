import { z } from 'zod'
import {
  agentRefusalCodeSchema,
  agentRunStatusSchema,
  agentRunVersionsSchema,
  agentStopReasonSchema,
  agentToolErrorCodeSchema,
  agentToolIdSchema,
} from './agent-run'

export const AGENT_TRACE_VERSION = 'trace-v1'

const idSchema = z.string().min(1)
const countSchema = z.number().int().nonnegative()

const traceBase = {
  seq: z.number().int().positive(),
  runId: idSchema,
  step: countSchema,
  at: z.string().datetime({ offset: true }),
}

export const agentTraceEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      ...traceBase,
      event: z.literal('run_started'),
      goalHash: idSchema,
      matterId: idSchema,
      toolAllowList: z.array(agentToolIdSchema),
      matterTextAllowed: z.boolean(),
      versions: agentRunVersionsSchema,
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('validation_failed'),
      field: idSchema,
      ruleId: idSchema,
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('step_started'),
      kind: z.enum(['model', 'tool']),
      tool: agentToolIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('tool_called'),
      tool: agentToolIdSchema,
      toolVersion: idSchema,
      argsHash: idSchema,
      status: z.enum(['ok', 'error']),
      errorCode: agentToolErrorCodeSchema.nullable(),
      evidenceIds: z.array(idSchema),
      contentHash: idSchema.nullable(),
      truncated: z.boolean(),
      latencyMs: countSchema,
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('tool_refused'),
      tool: z.string().min(1).max(64),
      code: agentRefusalCodeSchema,
      ruleId: idSchema,
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('model_called'),
      snapshot: idSchema,
      promptHash: idSchema,
      reservedTokens: countSchema,
      settledTokens: countSchema,
      reservedCostMicros: countSchema,
      settledCostMicros: countSchema,
      finish: z.enum(['tool_use', 'end_turn', 'max_tokens', 'error']),
      latencyMs: countSchema,
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('model_refused'),
      ruleId: idSchema,
      reservedTokens: countSchema,
      reservedCostMicros: countSchema,
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('claim_written'),
      claimIndex: countSchema,
      evidenceIds: z.array(idSchema).min(1),
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('claim_dropped'),
      claimIndex: countSchema,
      reason: z.enum(['no_evidence', 'fabricated_evidence_id']),
    })
    .strict(),
  z
    .object({
      ...traceBase,
      event: z.literal('stop'),
      status: agentRunStatusSchema,
      stopReason: agentStopReasonSchema,
      answerHash: idSchema.nullable(),
    })
    .strict(),
])
export type AgentTraceEvent = z.infer<typeof agentTraceEventSchema>
export type AgentTraceEventKind = AgentTraceEvent['event']
