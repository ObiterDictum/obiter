import { describe, expect, it } from 'bun:test'

import { emptyDraftState } from './document-draft-state'
import { emptyFormatDrafts } from './document-format-types'

describe('fresh draft state', () => {
  it('gives every fresh draft state its own format map', () => {
    const first = emptyDraftState()
    const second = emptyDraftState()
    first.format.paragraphStyles.p1 = 'Heading1'

    expect(second.format.paragraphStyles).toEqual({})
    expect(emptyFormatDrafts.paragraphStyles).toEqual({})
  })
})
