import { describe, expect, it } from 'bun:test'
import { KEEP_LABELS, shouldRedact, type PiiLabel } from './types'

describe('KEEP_LABELS', () => {
  it('keeps only city, state and ZIP code by default', () => {
    expect([...KEEP_LABELS].sort()).toEqual(['CITY', 'STATE', 'ZIP_CODE'])
  })

  it('keeps broad geography while the precise street line is still redacted', () => {
    expect(shouldRedact('CITY')).toBe(false)
    expect(shouldRedact('STATE')).toBe(false)
    expect(shouldRedact('ZIP_CODE')).toBe(false)
    expect(shouldRedact('BUILDING_NUMBER')).toBe(true)
    expect(shouldRedact('STREET_NAME')).toBe(true)
  })
})

describe('shouldRedact', () => {
  it('redacts every label the keep set does not name', () => {
    expect(shouldRedact('EMAIL')).toBe(true)
    expect(shouldRedact('SSN')).toBe(true)
    expect(shouldRedact('GIVEN_NAME')).toBe(true)
  })

  it('uses an explicit keep set in place of the default', () => {
    const keep = new Set<PiiLabel>(['EMAIL'])
    expect(shouldRedact('EMAIL', keep)).toBe(false)
    expect(shouldRedact('CITY', keep)).toBe(true)
  })
})
