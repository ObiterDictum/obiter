import { describe, expect, it } from 'bun:test'
import {
  MIN_PASSWORD_LENGTH,
  USER_NAME_MAX_LENGTH,
  updateProfileInputSchema,
} from './account'
import { parseOrganisationName } from './organisation'

describe('updateProfileInputSchema', () => {
  it('keeps the cleaned name the client should display back', () => {
    expect(
      updateProfileInputSchema.parse({ name: '  Imogen Hartley  ' }),
    ).toEqual({ name: 'Imogen Hartley' })
  })

  it('strips format characters, so an invisible name cannot be stored', () => {
    expect(
      updateProfileInputSchema.parse({ name: '\u200b\u200bAda\u200b' }),
    ).toEqual({ name: 'Ada' })
    expect(
      updateProfileInputSchema.safeParse({ name: '\u200b\u200b' }).success,
    ).toBe(false)
  })

  it('refuses a blank name and a name over the shared ceiling', () => {
    expect(updateProfileInputSchema.safeParse({ name: '   ' }).success).toBe(
      false,
    )
    expect(updateProfileInputSchema.safeParse({ name: 42 }).success).toBe(false)
    expect(updateProfileInputSchema.safeParse({}).success).toBe(false)
    expect(
      updateProfileInputSchema.safeParse({
        name: 'x'.repeat(USER_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false)
    expect(
      updateProfileInputSchema.safeParse({
        name: 'x'.repeat(USER_NAME_MAX_LENGTH),
      }).success,
    ).toBe(true)
  })

  it('drops fields the request was never allowed to set', () => {
    expect(
      updateProfileInputSchema.parse({ name: 'Ada', id: 'usr_other' }),
    ).toEqual({ name: 'Ada' })
  })
})

describe('parseOrganisationName — same name rule as the account name', () => {
  it('preserves the messages the organisation routes already return', () => {
    expect(parseOrganisationName(undefined)).toEqual({
      ok: false,
      message: 'Organisation name is required.',
    })
    expect(parseOrganisationName('   ')).toEqual({
      ok: false,
      message: 'Organisation name is required.',
    })
    expect(parseOrganisationName('\u200b')).toEqual({
      ok: false,
      message: 'Organisation name is required.',
    })
    expect(parseOrganisationName('x'.repeat(121))).toEqual({
      ok: false,
      message: 'Organisation name must be at most 120 characters.',
    })
  })

  it('returns the cleaned name for a valid one', () => {
    expect(parseOrganisationName('  Ashcombe Chambers  ')).toEqual({
      ok: true,
      name: 'Ashcombe Chambers',
    })
  })
})

describe('password policy constants', () => {
  it('states the policy the API is configured from', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })
})
