import { describe, expect, it } from 'vitest'
import { MarkerValidationError, stripMarkers } from './markers'

describe('stripMarkers', () => {
  it('strips markers and keeps exact UTF-16 offsets', () => {
    const result = stripMarkers(
      'Dear <pii category="person_private">Zoë Patel</pii>, email <pii category="email">zoe@example.test</pii>.',
    )
    expect(result.text).toBe('Dear Zoë Patel, email zoe@example.test.')
    expect(result.spans).toEqual([
      { category: 'person_private', start: 5, end: 14, text: 'Zoë Patel' },
      { category: 'email', start: 22, end: 38, text: 'zoe@example.test' },
    ])
  })

  it.each([
    '<pii category="unknown">value</pii>',
    '<pii category="person_private">value',
    'value</pii>',
    '<pii category="person_private">outer <pii category="email">inner</pii></pii>',
  ])('rejects malformed markers: %s', (input) => {
    expect(() => stripMarkers(input)).toThrow(MarkerValidationError)
  })
})
