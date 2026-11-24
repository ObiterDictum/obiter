import { describe, expect, it } from 'bun:test'
import { provisionResultLocation } from './legislation-navigation'

describe('provisionResultLocation', () => {
  it('maps a provision hit onto the splat route', () => {
    expect(
      provisionResultLocation({
        documentIdentity: 'ukpga/2010/15',
        labelPath: 'section/13',
      }),
    ).toEqual({
      to: '/ln/$',
      params: { _splat: 'ukpga/2010/15/section/13' },
    })
  })
})
