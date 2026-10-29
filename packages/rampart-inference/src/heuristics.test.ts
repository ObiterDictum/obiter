import { describe, expect, it } from 'bun:test'
import { detectHeuristics } from './heuristics'

describe('detectHeuristics digit rules', () => {
  it('matches an SSN whatever separator joins its digits', () => {
    for (const text of ['123-45-6789', '123 45 6789', '123.45.6789', '123456789'])
      expect(detectHeuristics(text)).toEqual([
        expect.objectContaining({ label: 'SSN', text }),
      ])
  })

  it('covers the interior separators of an SSN so redaction replaces it whole', () => {
    expect(detectHeuristics('id 123-45-6789 end')).toEqual([
      expect.objectContaining({
        start: 3,
        end: 14,
        label: 'SSN',
        text: '123-45-6789',
      }),
    ])
  })

  it('never fires a nine-digit SSN inside a longer account number', () => {
    expect(detectHeuristics('1234567890123')).toEqual([])
  })

  it('labels a Luhn-valid sixteen-digit run as a credit card', () => {
    expect(detectHeuristics('4242424242424242')).toEqual([
      expect.objectContaining({ label: 'CREDIT_CARD' }),
    ])
  })

  it('does not join digits across a word boundary into one run', () => {
    expect(detectHeuristics('12345 and income is 6789')).toEqual([])
  })

  it('reports a heuristic detection at full confidence', () => {
    expect(detectHeuristics('123-45-6789')[0]).toMatchObject({
      score: 1,
      source: 'heuristic',
    })
  })
})

describe('detectHeuristics text rules', () => {
  it('matches an email with plus-addressing and a sub-domain', () => {
    expect(detectHeuristics('write to alex+housing@sub.example.gov now')[0]).toMatchObject(
      { label: 'EMAIL', text: 'alex+housing@sub.example.gov' },
    )
  })

  it('matches an explicit-scheme URL up to whitespace', () => {
    expect(detectHeuristics('see https://example.gov/a?b=1 next')[0]).toMatchObject({
      label: 'URL',
      text: 'https://example.gov/a?b=1',
    })
  })

  it('matches a schemeless www URL', () => {
    expect(detectHeuristics('see www.example.gov/a next')[0]).toMatchObject({
      label: 'URL',
      text: 'www.example.gov/a',
    })
  })

  it('matches an IPv4 address', () => {
    expect(detectHeuristics('from 192.168.0.1 today')[0]).toMatchObject({
      label: 'IP_ADDRESS',
      text: '192.168.0.1',
    })
  })

  it('never reads a clock time as an IPv6 address', () => {
    expect(detectHeuristics('at 12:34 today')).toEqual([])
  })

  it('labels a MAC address as an IP address', () => {
    expect(detectHeuristics('mac 00:1A:2B:3C:4D:5E end')[0]).toMatchObject({
      label: 'IP_ADDRESS',
      text: '00:1A:2B:3C:4D:5E',
    })
  })
})
