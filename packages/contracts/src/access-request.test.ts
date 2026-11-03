import { describe, expect, it } from 'bun:test'
import {
  confirmAccessRequestInputSchema,
  confirmAccessRequestResponseSchema,
  createAccessRequestInputSchema,
  isFreeWebmailAddress,
  isObviousNonUkAcademicAddress,
  type CreateAccessRequestInput,
} from './access-request'

const aRequest: CreateAccessRequestInput = {
  name: 'Alex Morgan',
  email: 'alex.morgan@harringtonvale.example',
  category: 'legal_professional',
  country: 'england_and_wales',
  organisationName: 'Harrington Vale LLP',
  setUpOrganisation: true,
  acceptedTerms: true,
  acceptedPrivacyNotice: true,
  detailsAreTrue: true,
}

describe('access request submission', () => {
  it('accepts a solicitor who has attested to all three conditions', () => {
    expect(createAccessRequestInputSchema.parse(aRequest)).toEqual(aRequest)
  })

  it('accepts a request that carries a bot-check token', () => {
    expect(
      createAccessRequestInputSchema.parse({
        ...aRequest,
        botCheckToken: 'turnstile-token',
      }),
    ).toMatchObject({ botCheckToken: 'turnstile-token' })
  })

  it('refuses a request that has not accepted the terms', () => {
    expect(
      createAccessRequestInputSchema.safeParse({
        ...aRequest,
        acceptedTerms: false,
      }).success,
    ).toBe(false)
  })

  it('refuses a request that has not confirmed the details are true', () => {
    expect(
      createAccessRequestInputSchema.safeParse({
        ...aRequest,
        detailsAreTrue: false,
      }).success,
    ).toBe(false)
  })

  it('refuses a regulator number so evidence can never reach storage', () => {
    expect(
      createAccessRequestInputSchema.safeParse({
        ...aRequest,
        regulatorNumber: 'SRA-123456',
      }).success,
    ).toBe(false)
  })

  it('refuses a category that is not one of the three eligible ones', () => {
    expect(
      createAccessRequestInputSchema.safeParse({
        ...aRequest,
        category: 'journalist',
      }).success,
    ).toBe(false)
  })

  it('refuses a country outside the United Kingdom', () => {
    expect(
      createAccessRequestInputSchema.safeParse({
        ...aRequest,
        country: 'france',
      }).success,
    ).toBe(false)
  })

  it('trims the name and organisation name the applicant typed', () => {
    expect(
      createAccessRequestInputSchema.parse({
        ...aRequest,
        name: '  Alex Morgan  ',
        organisationName: '  Harrington Vale LLP  ',
      }),
    ).toMatchObject({
      name: 'Alex Morgan',
      organisationName: 'Harrington Vale LLP',
    })
  })
})

describe('free webmail addresses', () => {
  it('recognises the consumer providers the licence does not accept', () => {
    for (const domain of [
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.co.uk',
      'live.com',
      'yahoo.co.uk',
      'icloud.com',
      'me.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
      'gmx.com',
    ]) {
      expect(isFreeWebmailAddress(`alex@${domain}`), domain).toBe(true)
    }
  })

  it('compares the domain case-insensitively', () => {
    expect(isFreeWebmailAddress('Alex@GMAIL.com')).toBe(true)
  })

  it('accepts a work address that merely mentions a webmail provider', () => {
    expect(isFreeWebmailAddress('alex@notgmail.com')).toBe(false)
    expect(isFreeWebmailAddress('alex@gmail.com.harringtonvale.example')).toBe(
      false,
    )
  })
})

describe('obvious non-UK academic addresses', () => {
  it('recognises the academic suffixes the client can rule out without the API', () => {
    for (const address of [
      'alex@law.harvard.edu',
      'alex@unimelb.edu.au',
      'alex@auckland.ac.nz',
      'alex@nus.edu.sg',
      'alex@u-tokyo.ac.jp',
    ]) {
      expect(isObviousNonUkAcademicAddress(address), address).toBe(true)
    }
  })

  it('leaves every UK university address to the API to decide', () => {
    expect(isObviousNonUkAcademicAddress('alex@ucl.ac.uk')).toBe(false)
    expect(isObviousNonUkAcademicAddress('alex@harringtonvale.example')).toBe(
      false,
    )
  })
})

describe('access request confirmation', () => {
  it('requires a token to confirm a link', () => {
    expect(
      confirmAccessRequestInputSchema.safeParse({ token: '  ' }).success,
    ).toBe(false)
  })

  it('names where a verified applicant goes next', () => {
    expect(
      confirmAccessRequestResponseSchema.parse({
        status: 'verified',
        next: 'account_setup',
      }),
    ).toEqual({ status: 'verified', next: 'account_setup' })
  })

  it('parses the three states that send the applicant no further', () => {
    for (const status of ['pending_review', 'expired', 'invalid'] as const) {
      expect(confirmAccessRequestResponseSchema.parse({ status })).toEqual({
        status,
      })
    }
  })

  it('refuses a verified response that does not say where to go next', () => {
    expect(
      confirmAccessRequestResponseSchema.safeParse({ status: 'verified' })
        .success,
    ).toBe(false)
  })

  it('refuses a status the applicant flow does not have', () => {
    expect(
      confirmAccessRequestResponseSchema.safeParse({ status: 'approved' })
        .success,
    ).toBe(false)
  })
})
