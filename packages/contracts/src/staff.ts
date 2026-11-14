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

export const staffOverviewResponseSchema = z.object({
  accessReview: z.object({
    waiting: z.number().int().nonnegative(),
    oldestWaitingAt: z.string().nullable(),
  }),
  feedback: z.object({
    unread: z.number().int().nonnegative(),
  }),
  accounts: z.object({
    last7Days: z.number().int().nonnegative(),
    last30Days: z.number().int().nonnegative(),
  }),
  organisations: z.object({
    last7Days: z.number().int().nonnegative(),
    last30Days: z.number().int().nonnegative(),
  }),
  activeUsers: z.object({
    today: z.number().int().nonnegative(),
    last7Days: z.number().int().nonnegative(),
    last30Days: z.number().int().nonnegative(),
  }),
})
export type StaffOverviewResponse = z.infer<typeof staffOverviewResponseSchema>

export const staffUsageQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(12),
})
export type StaffUsageQuery = z.infer<typeof staffUsageQuerySchema>

const staffUsageCountsSchema = z.object({
  activeUsers: z.number().int().nonnegative(),
  newAccounts: z.number().int().nonnegative(),
  documentsOpened: z.number().int().nonnegative(),
  documentsSaved: z.number().int().nonnegative(),
  mattersCreated: z.number().int().nonnegative(),
  redactionRuns: z.number().int().nonnegative(),
  verificationRuns: z.number().int().nonnegative(),
  agentRuns: z.number().int().nonnegative(),
  sourcesSaved: z.number().int().nonnegative(),
})

export const staffUsageWeekSchema = staffUsageCountsSchema.extend({
  weekStart: z.string(),
})
export type StaffUsageWeek = z.infer<typeof staffUsageWeekSchema>

export const staffUsageOrganisationSchema = staffUsageCountsSchema.extend({
  organisationId: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
})
export type StaffUsageOrganisation = z.infer<
  typeof staffUsageOrganisationSchema
>

export const staffUsageRetentionSchema = z.object({
  cohortWeek: z.string(),
  cohortSize: z.number().int().nonnegative(),
  weekStart: z.string(),
  activeUsers: z.number().int().nonnegative(),
})
export type StaffUsageRetention = z.infer<typeof staffUsageRetentionSchema>

export const staffUsageResponseSchema = z.object({
  windowWeeks: z.number().int().positive(),
  weeks: z.array(staffUsageWeekSchema),
  organisations: z.array(staffUsageOrganisationSchema),
  retention: z.array(staffUsageRetentionSchema),
})
export type StaffUsageResponse = z.infer<typeof staffUsageResponseSchema>

export const staffFeedbackQuerySchema = z.object({
  kind: z.enum(['problem', 'idea', 'question']).optional(),
  status: z.enum(['open', 'handled', 'all']).default('open'),
})
export type StaffFeedbackQuery = z.infer<typeof staffFeedbackQuerySchema>

export const staffFeedbackItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['problem', 'idea', 'question']),
  message: z.string(),
  senderName: z.string(),
  senderEmail: z.string(),
  organisationName: z.string(),
  path: z.string().nullable(),
  appVersion: z.string().nullable(),
  platform: z.string().nullable(),
  createdAt: z.string(),
  handledAt: z.string().nullable(),
  handledByName: z.string().nullable(),
})
export type StaffFeedbackItem = z.infer<typeof staffFeedbackItemSchema>

export const staffFeedbackListResponseSchema = z.object({
  feedback: z.array(staffFeedbackItemSchema),
})
export type StaffFeedbackListResponse = z.infer<
  typeof staffFeedbackListResponseSchema
>

export const staffFeedbackHandledInputSchema = z.object({
  handled: z.boolean(),
})
export type StaffFeedbackHandledInput = z.infer<
  typeof staffFeedbackHandledInputSchema
>

export const staffFeedbackHandledResponseSchema = z.object({
  handledAt: z.string().nullable(),
})
export type StaffFeedbackHandledResponse = z.infer<
  typeof staffFeedbackHandledResponseSchema
>
