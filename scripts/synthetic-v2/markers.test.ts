import { describe, expect, it } from 'vitest'
import { MarkerValidationError, stripMarkers } from './markers'

describe('stripMarkers', () => {
  it('strips markers and keeps exact UTF-16 offsets', () => {
    const result = stripMarkers(
      'Dear ⟦person_private⟧Zoë Patel⟦/⟧, email ⟦email⟧zoe@example.test⟦/⟧.',
    )
    expect(result.text).toBe('Dear Zoë Patel, email zoe@example.test.')
    expect(result.spans).toEqual([
      { category: 'person_private', start: 5, end: 14, text: 'Zoë Patel' },
      { category: 'email', start: 22, end: 38, text: 'zoe@example.test' },
    ])
  })

  it.each([
    '⟦unknown⟧value⟦/⟧',
    '⟦person_private⟧value',
    'value⟦/⟧',
    '⟦person_private⟧outer ⟦email⟧inner⟦/⟧⟦/⟧',
  ])('rejects malformed markers: %s', (input) => {
    expect(() => stripMarkers(input)).toThrow(MarkerValidationError)
  })
})
