import { describe, expect, it } from 'bun:test'
import {
  legislationCheckedLabel,
  legislationStatusDisplay,
} from './legislation-status'

describe('legislationStatusDisplay', () => {
  it('dates a repeal when the date is known', () => {
    expect(legislationStatusDisplay('repealed', '2010-10-01')).toEqual({
      tone: 'neutral',
      label: 'Repealed from 1 Oct 2010',
    })
    expect(legislationStatusDisplay('repealed').label).toBe('Repealed')
  })

  it('labels current text and text with unapplied changes', () => {
    expect(legislationStatusDisplay('current').label).toBe(
      'No unapplied amendments',
    )
    expect(legislationStatusDisplay('amended_not_held')).toEqual({
      tone: 'warning',
      label: 'May not be up to date',
    })
  })
})

describe('legislationCheckedLabel', () => {
  it('names the day the text was checked against legislation.gov.uk', () => {
    expect(
      legislationCheckedLabel({ effectsCheckedAt: '2026-11-12T09:00:00Z' }),
    ).toBe('Checked against legislation.gov.uk on 12 Nov 2026')
    expect(
      legislationCheckedLabel({
        effectsCheckedAt: '2026-09-10T09:00:00Z',
        effectsCheckedUntil: '2026-09-10T18:00:00Z',
      }),
    ).toBe('Checked against legislation.gov.uk on 10 Sept 2026')
  })

  it('gives a range when an Act was checked over several days', () => {
    expect(
      legislationCheckedLabel({
        effectsCheckedAt: '2026-09-10T09:00:00Z',
        effectsCheckedUntil: '2026-11-12T09:00:00Z',
      }),
    ).toBe(
      'Checked against legislation.gov.uk between 10 Sept 2026 and 12 Nov 2026',
    )
  })

  it('falls back to the retrieval date and says changes were not checked', () => {
    expect(
      legislationCheckedLabel({ acquiredAt: '2026-09-06T14:49:54Z' }),
    ).toBe(
      'Retrieved from legislation.gov.uk on 6 Sept 2026; not yet checked for later changes',
    )
    expect(legislationCheckedLabel({})).toBe(
      'Not yet checked against legislation.gov.uk',
    )
  })
})
