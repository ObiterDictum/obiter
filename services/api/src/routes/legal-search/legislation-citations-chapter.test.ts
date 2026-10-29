import { describe, expect, it } from 'bun:test'
import {
  classifyLegislationCitation,
  createActDirectory,
} from './legislation-citations'
import { directory } from './legislation-citations.test-support'

describe('chapter citation classification', () => {
  it('resolves chapter numbers', () => {
    const outcome = classifyLegislationCitation('1998 c.42', directory)
    expect(outcome).toEqual({
      kind: 'act',
      act: {
        actType: 'ukpga',
        year: 1998,
        number: 42,
        identity: 'ukpga/1998/42',
        title: 'Human Rights Act 1998',
      },
      recognisedQuery: '1998 c.42',
    })
  })

  it('still reports an absent canonical chapter as not held', () => {
    expect(classifyLegislationCitation('2008 c. 12', directory)).toEqual({
      kind: 'not_held',
      identity: 'ukpga/2008/12',
      recognisedQuery: '2008 c. 12',
    })
  })

  it('reports an unheld chapter number as not held', () => {
    expect(classifyLegislationCitation('2008 c. 12', directory)).toEqual({
      kind: 'not_held',
      identity: 'ukpga/2008/12',
      recognisedQuery: '2008 c. 12',
    })
  })

  it.each([
    '1998 c. 42',
    '1998,c.42',
    '1998 c.42',
    '1998 c 42',
    '  1998   c.   42  ',
    '1998 C 42',
  ])('resolves the whitespace and punctuation variant %j', (query) => {
    expect(classifyLegislationCitation(query, directory).kind).toBe('act')
  })

  it('resolves a held chapter whose number is zero-padded', () => {
    const outcome = classifyLegislationCitation('1998 c. 042', directory)
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act') {
      expect(outcome.act.identity).toBe('ukpga/1998/42')
    }
  })

  it('derives the unpadded chapter identity for an unheld zero-padded number', () => {
    expect(classifyLegislationCitation('2066 c. 042', directory)).toEqual({
      kind: 'not_held',
      identity: 'ukpga/2066/42',
      recognisedQuery: '2066 c. 042',
    })
  })

  it('resolves a supported historical year to its canonical identity', () => {
    expect(classifyLegislationCitation('1801 c. 1', directory)).toEqual({
      kind: 'not_held',
      identity: 'ukpga/1801/1',
      recognisedQuery: '1801 c. 1',
    })
  })

  it.each(['1801 c. 1', '2024 c. 1', '2066 c. 1', '9999 c. 1'])(
    'accepts the supported year %j',
    (query) => {
      const outcome = classifyLegislationCitation(query, directory)
      expect(outcome.kind === 'not_held' || outcome.kind === 'act').toBe(true)
    },
  )

  it('resolves a held current or future year against the directory', () => {
    const future = createActDirectory([
      {
        actType: 'ukpga',
        year: 2066,
        number: 1,
        identity: 'ukpga/2066/1',
        title: 'Future Test Act 2066',
      },
    ])
    expect(classifyLegislationCitation('2066 c. 1', future)).toMatchObject({
      kind: 'act',
      act: { identity: 'ukpga/2066/1' },
    })
  })

  it.each([
    '0204 c. 1',
    '0000 c. 1',
    '1800 c. 1',
    '0999 c. 1',
    '99999 c. 1',
    '2066.5 c. 1',
    '2066.0 c. 1',
    '2e3 c. 1',
    '-2066 c. 1',
    '+2066 c. 1',
    '２０６６ c. 1',
    '2066 c. -1',
    '2066 c. +1',
    '2066 c. 1e3',
    '2066 c. 0',
    '2066 c. 99999999999999999999',
    '2066 c. 1.5',
  ])('refuses %j as not a chapter citation', (query) => {
    expect(classifyLegislationCitation(query, directory).kind).toBe(
      'unrecognised',
    )
  })

  it('never emits a non-canonical identity for an accepted chapter', () => {
    for (const query of ['1801 c. 1', '2066 c. 042', '9999 c. 99']) {
      const outcome = classifyLegislationCitation(query, directory)
      expect(outcome.kind).toBe('not_held')
      if (outcome.kind === 'not_held') {
        expect(outcome.identity).toMatch(/^ukpga\/[0-9]{4}\/[1-9][0-9]*$/)
      }
    }
  })
})
