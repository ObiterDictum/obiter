import {
  accessRequestCountrySchema,
  accessRequestEmailFieldSchema,
  createAccessRequestInputSchema,
  isFreeWebmailAddress,
  isObviousNonUkAcademicAddress,
  type AccessRequestCategory,
  type AccessRequestCountry,
  type CreateAccessRequestInput,
} from '@obiter/contracts'
import { FREE_WEBMAIL_MESSAGE, NON_UK_ADDRESS_MESSAGE } from '../access-request'

export const CATEGORY_OPTIONS: {
  value: AccessRequestCategory
  label: string
  description: string
}[] = [
  {
    value: 'legal_professional',
    label: 'Legal professional',
    description:
      'Solicitor, barrister, advocate, legal executive, licensed conveyancer, trainee, pupil, paralegal or in-house lawyer.',
  },
  {
    value: 'law_student',
    label: 'Law student',
    description:
      'Undergraduate, postgraduate, LPC, SQE, BPTC or diploma student at a UK institution.',
  },
  {
    value: 'academic_researcher',
    label: 'Academic researcher',
    description:
      'Academic staff or research student working on law at a UK institution.',
  },
]

export const COUNTRY_OPTIONS: { value: AccessRequestCountry; label: string }[] =
  [
    { value: 'england_and_wales', label: 'England and Wales' },
    { value: 'scotland', label: 'Scotland' },
    { value: 'northern_ireland', label: 'Northern Ireland' },
  ]

export function countryFromSelect(
  value: string | null,
): AccessRequestCountry | '' {
  const parsed = accessRequestCountrySchema.safeParse(value)
  return parsed.success ? parsed.data : ''
}

type FieldName =
  | 'name'
  | 'email'
  | 'category'
  | 'country'
  | 'organisationName'
  | 'attestations'
  | 'form'

export type FieldErrors = Partial<Record<FieldName, string>>

export interface RequestAccessForm {
  name: string
  email: string
  category: AccessRequestCategory | ''
  country: AccessRequestCountry | ''
  organisationName: string
  setUpOrganisation: boolean
  acceptedTerms: boolean
  acceptedPrivacyNotice: boolean
  detailsAreTrue: boolean
}

interface RequestAccessValidation {
  errors: FieldErrors
  input: CreateAccessRequestInput | null
}

export function validateRequestAccess(
  form: RequestAccessForm,
): RequestAccessValidation {
  const errors: FieldErrors = {}
  const email = form.email.trim()

  if (form.name.trim().length === 0) errors.name = 'Name is required.'
  if (email.length === 0) errors.email = 'Email is required.'
  else if (isFreeWebmailAddress(email)) errors.email = FREE_WEBMAIL_MESSAGE
  else if (isObviousNonUkAcademicAddress(email))
    errors.email = NON_UK_ADDRESS_MESSAGE
  else if (!accessRequestEmailFieldSchema.safeParse(email).success)
    errors.email = 'Enter an email address.'
  if (!form.category) errors.category = 'Choose the category that fits you.'
  if (!form.country) errors.country = 'Choose where you are based.'
  if (form.organisationName.trim().length === 0)
    errors.organisationName = 'Organisation name is required.'
  if (
    !form.acceptedTerms ||
    !form.acceptedPrivacyNotice ||
    !form.detailsAreTrue
  )
    errors.attestations =
      'Accept the terms of service, confirm you have read the privacy policy and confirm your details before sending.'

  if (Object.keys(errors).length > 0) return { errors, input: null }

  const parsed = createAccessRequestInputSchema.safeParse({
    name: form.name,
    email,
    category: form.category,
    country: form.country,
    organisationName: form.organisationName,
    setUpOrganisation: form.setUpOrganisation,
    acceptedTerms: form.acceptedTerms,
    acceptedPrivacyNotice: form.acceptedPrivacyNotice,
    detailsAreTrue: form.detailsAreTrue,
  })
  if (!parsed.success) {
    return {
      errors: {
        form:
          parsed.error.issues[0]?.message ?? 'Check the form and try again.',
      },
      input: null,
    }
  }
  return { errors, input: parsed.data }
}
