import { describe, expect, it } from 'bun:test'
import { legislationStatusDisplay } from './legislation-status'

describe('legislationStatusDisplay', () => {
  it('dates a repeal when the date is known', () => {
    expect(legislationStatusDisplay('repealed', '2010-10-01')).toEqual({
      tone: 'neutral',
      label: 'Repealed from 1 Oct 2010',
    })
    expect(legislationStatusDisplay('repealed').label).toBe('Repealed')
  })

  it('keeps the existing labels for current and withheld text', () => {
    expect(legislationStatusDisplay('current').label).toBe(
      'No unapplied amendments',
    )
    expect(legislationStatusDisplay('amended_not_held').tone).toBe('warning')
  })
})
