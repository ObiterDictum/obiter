import { z } from 'zod'
import {
  accessRequestCategorySchema,
  accessRequestCountrySchema,
} from './access-request'

export const staffDecisionInputSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('domain'),
      domain: z.string().min(1).max(253).toLowerCase(),
    }),
    z.object({
      kind: z.literal('person'),
      requestId: z.string().startsWith('ar_').max(255),
    }),
  ]),
  decision: z.enum(['approve', 'decline']),
  organisationId: z.string().min(1).max(255).optional(),
})
export type StaffDecisionInput = z.infer<typeof staffDecisionInputSchema>
export const staffQueueResponseSchema = z.object({
  groups: z.array(
    z.object({
      domain: z.string(),
      organisationNames: z.array(z.string()),
      count: z.number().int().nonnegative(),
      categories: z.array(accessRequestCategorySchema),
      countries: z.array(accessRequestCountrySchema),
      oldestCreatedAt: z.string(),
      requests: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
          category: accessRequestCategorySchema,
          createdAt: z.string(),
        }),
      ),
    }),
  ),
})
export type StaffQueueResponse = z.infer<typeof staffQueueResponseSchema>
export const staffDecisionResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})
export const staffDecisionsResponseSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      targetKind: z.enum(['domain', 'person']),
      target: z.string(),
      decision: z.enum(['approve', 'decline']),
      staffName: z.string(),
      createdAt: z.string(),
    }),
  ),
})
export type StaffDecisionsResponse = z.infer<
  typeof staffDecisionsResponseSchema
>
export type StaffDecision = StaffDecisionsResponse['decisions'][number]
export const staffOrganisationsResponseSchema = z.object({
  organisations: z.array(z.object({ id: z.string(), name: z.string() })),
})
export const accessSetupInputSchema = z.object({
  token: z.string().min(1).max(256),
})
export const accessSetupResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified'), email: z.string().email() }),
  z.object({ status: z.literal('invalid') }),
  z.object({ status: z.literal('expired') }),
])
