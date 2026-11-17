import { z } from 'zod'

export const agentThinkingLevelSchema = z.enum(['off', 'low', 'medium', 'high'])
export type AgentThinkingLevel = z.infer<typeof agentThinkingLevelSchema>
export const agentAvailableModelSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.enum(['anthropic', 'connection']).optional(),
    recommended: z.boolean().optional(),
    provider: z.enum(['anthropic', 'openai_compatible']),
    connectionId: z.string().uuid().nullable().optional(),
    rawModelId: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
    label: z.string().min(1),
    description: z.string().min(1),
    thinkingLevels: z.array(agentThinkingLevelSchema).min(1),
    defaultThinking: agentThinkingLevelSchema,
  })
  .strict()
  .refine(
    (model) => model.thinkingLevels.includes(model.defaultThinking),
    'Default thinking must be supported.',
  )
export type AgentAvailableModel = z.infer<typeof agentAvailableModelSchema>
export const agentModelsResponseSchema = z
  .object({
    models: z.array(agentAvailableModelSchema),
    default: z.string().nullable(),
    defaultThinking: agentThinkingLevelSchema,
    reason: z.literal('not_configured').optional(),
  })
  .strict()
export type AgentModelsResponse = z.infer<typeof agentModelsResponseSchema>
