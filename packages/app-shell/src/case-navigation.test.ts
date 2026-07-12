import { describe, expect, it } from 'vitest'
import { caseResultLocation } from './case-navigation'

describe('caseResultLocation', () => {
  it('maps canonical /case/:slug URLs to the slug route', () => {
    expect(
      caseResultLocation({
        id: 'uksc-2024-3',
        canonicalUrl: '/case/potanina-v-potanin-2024-uksc-3',
      }),
    ).toEqual({
      to: '/case/$caseSlug',
      params: { caseSlug: 'potanina-v-potanin-2024-uksc-3' },
    })
  })

  it('maps missing canonical URLs to /cases/$caseId', () => {
    expect(caseResultLocation({ id: 'd-1234', canonicalUrl: null })).toEqual({
      to: '/cases/$caseId',
      params: { caseId: 'd-1234' },
    })
  })
})
