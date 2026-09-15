import { z } from 'zod'
import { currentUserSchema, displayNameField } from './organisation'

/**
 * Account settings for the authenticated user: the name they are shown under,
 * and the password policy every password form and the API must agree on.
 * Organisation and membership shapes stay in `organisation.ts`; the barrel
 * re-exports both, so `@obiter/contracts` remains the one import path.
 */

export const USER_NAME_MAX_LENGTH = 120

/**
 * The account name. Shared with client forms so the form cannot promise a name
 * the API rejects: blank, whitespace-only and format-character-only names are
 * refused here (see `displayNameField`), and the stored value is the cleaned
 * one, so the client never has to guess what the server kept.
 */
export const accountNameFieldSchema = displayNameField(
  'Name',
  USER_NAME_MAX_LENGTH,
)

export const updateProfileInputSchema = z.object({
  name: accountNameFieldSchema,
})
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>

export const updateProfileResponseSchema = z.object({
  user: currentUserSchema,
})
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>

/**
 * Password length policy. `services/api/src/auth.ts` configures better-auth
 * from these values, and the password forms state them before submission, so
 * the requirement shown is the requirement enforced.
 */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128
