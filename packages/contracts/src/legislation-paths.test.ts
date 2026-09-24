import { describe, expect, it } from 'bun:test'
import {
  createCanonicalActPath,
  createCanonicalProvisionPath,
  firstUkpgaYear,
  isCanonicalActYear,
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from './legislation-paths'

describe('legislation provision paths', () => {
  it('builds a stable identity path a solicitor can paste', () => {
    expect(createCanonicalProvisionPath('ukpga/2010/15', 'section/40')).toBe(
      '/ln/ukpga/2010/15/section/40',
    )
    expect(
      createCanonicalProvisionPath('ukpga/2010/15', 'section/13/2/a'),
    ).toBe('/ln/ukpga/2010/15/section/13/2/a')
  })

  it('parses the identity path back into a provision id', () => {
    expect(
      parseLegislationProvisionPath('/ln/ukpga/2010/15/section/40'),
    ).toEqual({
      documentIdentity: 'ukpga/2010/15',
      labelPath: 'section/40',
      provisionId: 'ukpga/2010/15/section/40',
    })
    expect(
      parseLegislationProvisionPath('ukpga/1998/42/schedule/2/paragraph/4'),
    ).toEqual({
      documentIdentity: 'ukpga/1998/42',
      labelPath: 'schedule/2/paragraph/4',
      provisionId: 'ukpga/1998/42/schedule/2/paragraph/4',
    })
  })

  it('rejects act-only paths and non-ukpga identities', () => {
    expect(parseLegislationProvisionPath('/ln/ukpga/2010/15')).toBeNull()
    expect(
      parseLegislationProvisionPath('/ln/uksi/2020/1/regulation/2'),
    ).toBeNull()
    expect(parseLegislationProvisionPath('/ln/not-an-id')).toBeNull()
  })

  it('builds and parses bare Act paths', () => {
    expect(createCanonicalActPath('ukpga/2020/17')).toBe('/ln/ukpga/2020/17')
    expect(parseLegislationActPath('/ln/ukpga/2020/17')).toEqual({
      documentIdentity: 'ukpga/2020/17',
    })
    expect(parseLegislationActPath('ukpga/1998/42')).toEqual({
      documentIdentity: 'ukpga/1998/42',
    })
  })

  it('rejects provision paths and non-ukpga Act paths', () => {
    expect(parseLegislationActPath('/ln/ukpga/2010/15/section/40')).toBeNull()
    expect(parseLegislationActPath('/ln/uksi/2020/1')).toBeNull()
    expect(parseLegislationActPath('/ln/ukpga/2010')).toBeNull()
    expect(parseLegislationActPath('/ln/not-an-id')).toBeNull()
  })

  it('refuses a non-canonical Act year in a pasted path', () => {
    // The canonical identity grammar is the same one the free-text chapter
    // classifier applies, so a zero-padded or pre-1801 year is not canonical
    // here either rather than producing an identity Number() would rewrite.
    for (const path of [
      '/ln/ukpga/0204/1',
      '/ln/ukpga/0000/1',
      '/ln/ukpga/1800/1',
      '/ln/ukpga/0204/1/section/2',
    ]) {
      expect(parseLegislationActPath(path)).toBeNull()
      expect(parseLegislationProvisionPath(path)).toBeNull()
    }
  })
})

describe('canonical Act years', () => {
  it('states the first supported year once', () => {
    expect(firstUkpgaYear).toBe(1801)
  })

  it.each(['1801', '1998', '2024', '2066', '9999'])(
    'accepts the four-digit year %s',
    (year) => {
      expect(isCanonicalActYear(year)).toBe(true)
    },
  )

  it.each([
    '0204',
    '0000',
    '0999',
    '1800',
    '999',
    '10000',
    '20 4',
    'abcd',
    '',
    ' 2024',
  ])('refuses %j', (year) => {
    expect(isCanonicalActYear(year)).toBe(false)
  })
})
