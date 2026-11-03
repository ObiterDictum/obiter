import { z } from 'zod'
import { accountNameFieldSchema } from './account'
import { organisationNameFieldSchema } from './organisation'

export const accessRequestCategorySchema = z.enum([
  'legal_professional',
  'law_student',
  'academic_researcher',
])
export type AccessRequestCategory = z.infer<typeof accessRequestCategorySchema>

export const accessRequestCountrySchema = z.enum([
  'england_and_wales',
  'scotland',
  'northern_ireland',
])
export type AccessRequestCountry = z.infer<typeof accessRequestCountrySchema>

export const ACCESS_REQUEST_EMAIL_MAX_LENGTH = 320

export const accessRequestEmailFieldSchema = z
  .string()
  .trim()
  .max(ACCESS_REQUEST_EMAIL_MAX_LENGTH, 'Email address is too long.')
  .pipe(z.string().email('Enter an email address.'))

export const FREE_WEBMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
] as const

export const NON_UK_ACADEMIC_DOMAIN_SUFFIXES = [
  'edu',
  'edu.au',
  'ac.nz',
  'ac.jp',
  'ac.za',
  'ac.in',
  'edu.sg',
  'edu.hk',
  'edu.my',
] as const

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase()
}

const FREE_WEBMAIL_DOMAIN_SET = new Set<string>(FREE_WEBMAIL_DOMAINS)

export function isFreeWebmailAddress(email: string): boolean {
  return FREE_WEBMAIL_DOMAIN_SET.has(emailDomain(email))
}

export function isObviousNonUkAcademicAddress(email: string): boolean {
  const domain = emailDomain(email)
  return NON_UK_ACADEMIC_DOMAIN_SUFFIXES.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
  )
}

export const createAccessRequestInputSchema = z
  .object({
    name: accountNameFieldSchema,
    email: accessRequestEmailFieldSchema,
    category: accessRequestCategorySchema,
    country: accessRequestCountrySchema,
    organisationName: organisationNameFieldSchema,
    setUpOrganisation: z.boolean(),
    acceptedTerms: z.literal(true),
    acceptedPrivacyNotice: z.literal(true),
    detailsAreTrue: z.literal(true),
    botCheckToken: z.string().trim().max(4096).optional(),
  })
  .strict()
export type CreateAccessRequestInput = z.infer<
  typeof createAccessRequestInputSchema
>

export const createAccessRequestResponseSchema = z
  .object({ status: z.literal('confirmation_sent') })
  .strict()
export type CreateAccessRequestResponse = z.infer<
  typeof createAccessRequestResponseSchema
>

export const confirmAccessRequestInputSchema = z
  .object({ token: z.string().trim().min(1) })
  .strict()
export type ConfirmAccessRequestInput = z.infer<
  typeof confirmAccessRequestInputSchema
>

export const accessRequestNextStepSchema = z.enum(['account_setup', 'sign_in'])
export type AccessRequestNextStep = z.infer<typeof accessRequestNextStepSchema>

export const confirmAccessRequestResponseSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('verified'),
        next: accessRequestNextStepSchema,
      })
      .strict(),
    z.object({ status: z.literal('pending_review') }).strict(),
    z.object({ status: z.literal('expired') }).strict(),
    z.object({ status: z.literal('invalid') }).strict(),
  ],
)
export type ConfirmAccessRequestResponse = z.infer<
  typeof confirmAccessRequestResponseSchema
>
