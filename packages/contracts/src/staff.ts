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

export const staffBuzzRoleSchema = z.enum(['operations', 'corpus'])
export type StaffBuzzRole = z.infer<typeof staffBuzzRoleSchema>
export const staffBuzzStatusSchema = z.enum([
  'unlinked',
  'not_member',
  'active',
])
export type StaffBuzzStatus = z.infer<typeof staffBuzzStatusSchema>
export const staffBuzzAgentSchema = z.enum([
  'Clerk',
  'Reporter',
  'Scribe',
  'Examiner',
  'Registrar',
  'Archivist',
])
export type StaffBuzzAgent = z.infer<typeof staffBuzzAgentSchema>
export const STAFF_BUZZ_AGENT_ACCESS: Record<
  StaffBuzzAgent,
  StaffBuzzRole | 'staff'
> = {
  Clerk: 'staff',
  Reporter: 'staff',
  Scribe: 'staff',
  Examiner: 'staff',
  Registrar: 'operations',
  Archivist: 'corpus',
}
export function staffBuzzAgents(roles: readonly StaffBuzzRole[]) {
  return staffBuzzAgentSchema.options.filter((agent) => {
    const access = STAFF_BUZZ_AGENT_ACCESS[agent]
    return access === 'staff' || roles.includes(access)
  })
}
export const staffBuzzNpubSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^npub1[02-9ac-hj-np-z]{58}$/,
    'Paste the npub from your Buzz profile.',
  )
const staffBuzzMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  npub: z.string().nullable(),
  status: staffBuzzStatusSchema,
  roles: z.array(staffBuzzRoleSchema),
})
export type StaffBuzzMember = z.infer<typeof staffBuzzMemberSchema>
export const staffBuzzResponseSchema = z.object({
  available: z.boolean(),
  me: staffBuzzMemberSchema.extend({ agents: z.array(staffBuzzAgentSchema) }),
  canManage: z.boolean(),
  members: z.array(staffBuzzMemberSchema),
})
export type StaffBuzzResponse = z.infer<typeof staffBuzzResponseSchema>
export const staffBuzzInviteResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
})
export type StaffBuzzInviteResponse = z.infer<
  typeof staffBuzzInviteResponseSchema
>
export const staffBuzzKeyInputSchema = z.object({ npub: staffBuzzNpubSchema })
export type StaffBuzzKeyInput = z.infer<typeof staffBuzzKeyInputSchema>
export const staffBuzzRolesInputSchema = z.object({
  roles: z.array(staffBuzzRoleSchema).max(2),
})
export type StaffBuzzRolesInput = z.infer<typeof staffBuzzRolesInputSchema>
export const buzzRosterResponseSchema = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      pubkey: z.string().regex(/^[0-9a-f]{64}$/),
      roles: z.array(staffBuzzRoleSchema),
    }),
  ),
})
export type BuzzRosterResponse = z.infer<typeof buzzRosterResponseSchema>
