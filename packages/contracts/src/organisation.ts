import { z } from 'zod'

/**
 * Organisation, membership and the authenticated-user view. Split out of the
 * contracts barrel so that file stays under the RULES.md ceiling; the barrel
 * re-exports this module, so `@obiter/contracts` is still the one import path.
 */

export const userRoleSchema = z.enum(['owner', 'admin', 'member'])
export type UserRole = z.infer<typeof userRoleSchema>

export const organisationPlanSchema = z.enum(['private_beta'])
export type OrganisationPlan = z.infer<typeof organisationPlanSchema>

// role is nullable: a newly self-registered user has no organisation and no
// role until they explicitly create one. It is set to 'owner' on org creation.
export const currentUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: userRoleSchema.nullable(),
})
export type CurrentUser = z.infer<typeof currentUserSchema>

export const currentOrganisationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  plan: organisationPlanSchema,
})
export type CurrentOrganisation = z.infer<typeof currentOrganisationSchema>

// organisation is nullable: self-registration no longer provisions an org.
// GET /api/me returns { user, organisation: null } for an org-less user, and
// the client renders the create-organisation surface instead of matters.
export const meResponseSchema = z.object({
  user: currentUserSchema,
  organisation: currentOrganisationSchema.nullable(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

export const ORGANISATION_NAME_MAX_LENGTH = 120

/** Default tenant name for auto-provisioned workspaces (see ensureOrganisationForUser). */
export const PERSONAL_WORKSPACE_NAME = 'Personal workspace'

export const createOrganisationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Organisation name is required.')
    .max(ORGANISATION_NAME_MAX_LENGTH, 'Organisation name is too long.'),
})
export type CreateOrganisationInput = z.infer<
  typeof createOrganisationInputSchema
>

export const updateOrganisationInputSchema = createOrganisationInputSchema

export type UpdateOrganisationInput = z.infer<
  typeof updateOrganisationInputSchema
>

/**
 * Shared organisation-name validation for create + rename + sign-up stash
 * consumption: strip Unicode format characters (category Cf — zero-width
 * spaces, joiners, directional marks) as well as ASCII whitespace before
 * the emptiness check, so a name of only ZWSPs cannot pass trim() as
 * non-empty and store an invisible organisation name. Enforces the shared
 * length ceiling.
 */
export function parseOrganisationName(
  rawName: unknown,
): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof rawName !== 'string') {
    return { ok: false, message: 'Organisation name is required.' }
  }
  const name = rawName.replace(/\p{Cf}/gu, '').trim()
  if (name.length === 0) {
    return { ok: false, message: 'Organisation name is required.' }
  }
  if (name.length > ORGANISATION_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `Organisation name must be at most ${ORGANISATION_NAME_MAX_LENGTH} characters.`,
    }
  }
  return { ok: true, name }
}

export const createOrganisationInviteInputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: userRoleSchema,
})
export type CreateOrganisationInviteInput = z.infer<
  typeof createOrganisationInviteInputSchema
>

export const acceptOrganisationInviteInputSchema = z.object({
  token: z.string().min(1),
})
export type AcceptOrganisationInviteInput = z.infer<
  typeof acceptOrganisationInviteInputSchema
>

/**
 * Sign-up asks, for an invite's own email, whether an account already exists
 * so an existing invitee can be routed to sign-in instead of a duplicate-email
 * dead end. Only answerable for the email the invite was sent to.
 */
export const organisationInviteAccountExistsInputSchema = z.object({
  token: z.string().min(1),
  email: z.string().trim().email().max(320),
})
export type OrganisationInviteAccountExistsInput = z.infer<
  typeof organisationInviteAccountExistsInputSchema
>

export const organisationInviteAccountExistsSchema = z.object({
  hasAccount: z.boolean(),
})
export type OrganisationInviteAccountExists = z.infer<
  typeof organisationInviteAccountExistsSchema
>

export const organisationInvitePreviewSchema = z.object({
  organisationName: z.string().min(1),
  invitedByName: z.string().min(1),
})
export type OrganisationInvitePreview = z.infer<
  typeof organisationInvitePreviewSchema
>

export const organisationInviteSchema = z.object({
  id: z.string().min(1),
  organisationId: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema,
  expiresAt: z.string().datetime({ offset: true }),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
})
export type OrganisationInvite = z.infer<typeof organisationInviteSchema>

export const organisationMemberSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: userRoleSchema,
})
export type OrganisationMember = z.infer<typeof organisationMemberSchema>

export type AuthViewState =
  | { status: 'authenticated'; me: MeResponse }
  | { status: 'unauthenticated' }
  | { status: 'organisation_missing'; user: CurrentUser }
  | { status: 'organisation_inactive'; user: CurrentUser }
