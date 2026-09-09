import { describe, expect, it } from 'vitest'
import {
  createCanonicalProvisionPath,
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
})
