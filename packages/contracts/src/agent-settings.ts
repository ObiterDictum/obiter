import { z } from 'zod'

export const agentProviderSchema = z.enum(['anthropic'])
export type AgentProvider = z.infer<typeof agentProviderSchema>

export const AGENT_PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    modelIdPattern: /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    modelIdExample: 'claude-sonnet-4-5',
  },
} as const satisfies Record<
  AgentProvider,
  { label: string; modelIdPattern: RegExp; modelIdExample: string }
>

const modelIdSchema = z.string().trim().min(1).max(128)

export const agentModelChoiceSchema = z
  .object({
    provider: agentProviderSchema,
    modelId: modelIdSchema,
    snapshot: modelIdSchema.nullable(),
  })
  .strict()
  .superRefine((choice, context) => {
    const { modelIdPattern, modelIdExample, label } =
      AGENT_PROVIDERS[choice.provider]
    for (const field of ['modelId', 'snapshot'] as const) {
      const value = choice[field]
      if (value !== null && !modelIdPattern.test(value))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${label} model ids look like ${modelIdExample}.`,
        })
    }
  })
export type AgentModelChoice = z.infer<typeof agentModelChoiceSchema>

export const agentApiKeySchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^\S+$/, 'A key has no spaces.')

export const organisationAgentSettingsSchema = z
  .object({
    matterTextToModel: z.boolean(),
    model: agentModelChoiceSchema.nullable(),
    keyLastFour: z.string().length(4).nullable(),
    keySetAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (settings) =>
      (settings.keyLastFour === null) === (settings.keySetAt === null),
    { message: 'A stored key has a set date.', path: ['keySetAt'] },
  )
export type OrganisationAgentSettings = z.infer<
  typeof organisationAgentSettingsSchema
>

export const agentKeyChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('replace'), value: agentApiKeySchema }).strict(),
  z.object({ action: z.literal('remove') }).strict(),
])
export type AgentKeyChange = z.infer<typeof agentKeyChangeSchema>

export const organisationAgentSettingsUpdateSchema = z
  .object({
    matterTextToModel: z.boolean().optional(),
    model: agentModelChoiceSchema.optional(),
    key: agentKeyChangeSchema.optional(),
  })
  .strict()
  .refine((update) => Object.keys(update).length > 0, {
    message: 'Nothing to change.',
  })
export type OrganisationAgentSettingsUpdate = z.infer<
  typeof organisationAgentSettingsUpdateSchema
>
