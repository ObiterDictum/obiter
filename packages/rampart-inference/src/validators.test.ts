import { describe, expect, it } from 'bun:test'
import { isLuhnValid, isValidSsn } from './validators'

describe('isLuhnValid', () => {
  it('accepts a card number whose digits pass the Luhn checksum', () => {
    expect(isLuhnValid('4242424242424242')).toBe(true)
  })

  it('rejects an arbitrary sixteen-digit run that fails the Luhn checksum', () => {
    expect(isLuhnValid('4242424242424243')).toBe(false)
  })
})

describe('isValidSsn', () => {
  it('accepts a structurally valid nine-digit SSN', () => {
    expect(isValidSsn('123456789')).toBe(true)
  })

  it('rejects an SSN whose area is 000, 666 or 900 and above', () => {
    expect(isValidSsn('000456789')).toBe(false)
    expect(isValidSsn('666456789')).toBe(false)
    expect(isValidSsn('900456789')).toBe(false)
  })

  it('rejects an SSN whose group is 00 or whose serial is 0000', () => {
    expect(isValidSsn('123006789')).toBe(false)
    expect(isValidSsn('123450000')).toBe(false)
  })

  it('rejects a digit run that is not exactly nine digits', () => {
    expect(isValidSsn('12345678')).toBe(false)
    expect(isValidSsn('1234567890')).toBe(false)
  })
})
