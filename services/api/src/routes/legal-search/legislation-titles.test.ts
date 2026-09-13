import { describe, expect, it } from 'vitest'
import {
  classifyLegislationCitation,
  createActDirectory,
  type LegislationActDirectoryEntry,
} from './legislation-citations'
import { legislationTitleJoiningWords } from './legislation-titles'

/**
 * Title-shape tests for the whole-title-versus-prose boundary: the bounded
 * trailing punctuation and wrappers a title request may carry, the closed
 * joining-word grammar, and the absence of any caller-mutable grammar state.
 */

function entry(
  year: number,
  number: number,
  title: string,
): LegislationActDirectoryEntry {
  return {
    actType: 'ukpga',
    year,
    number,
    identity: `ukpga/${year}/${number}`,
    title,
  }
}

const held: LegislationActDirectoryEntry[] = [
  entry(1998, 42, 'Human Rights Act 1998'),
  entry(2010, 15, 'Equality Act 2010'),
]

// Teaches `of` and `the` as title-joining words.
const teachesOfAndTheEntries = [
  ...held,
  entry(2022, 1, 'Protection of the Person Act 2022'),
]

// Teaches only `of`.
const teachesOfEntries = [
  ...held,
  entry(2023, 42, 'Powers of Attorney Act 2023'),
]

// Teaches only `and`, so it has a non-empty grammar without `of` or `the`.
const teachesAndEntries = [
  ...held,
  entry(2022, 32, 'Police, Crime, Sentencing and Courts Act 2022'),
]

// Teaches a joining word the boundary must not adopt.
const teachesUnderEntries = [
  ...held,
  entry(2022, 3, 'Administration under Wills Act 2022'),
]

const teachesOfAndThe = createActDirectory(teachesOfAndTheEntries)
const teachesOf = createActDirectory(teachesOfEntries)
const teachesAnd = createActDirectory(teachesAndEntries)
const teachesUnder = createActDirectory(teachesUnderEntries)

describe('whole-title boundary', () => {
  it.each([
    'Children Act 1989.',
    'Children Act 1989?',
    'Children Act 1989!',
    '"Children Act 1989"',
    '“Children Act 1989”',
    'Children Act 1989)',
    'Children Act 1989 (repealed)',
    'Children Act 1989 (repealed).',
    'Data Protection Act 2018.',
  ])('suppresses the punctuated or wrapped unheld title %s', (query) => {
    // A standalone title request must never keyword-serve provisions of
    // unrelated Acts just because the caller typed a full stop or a quote.
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    'Children Act 1989 extra',
    'Children Act 1989 not repealed',
    'Children Act 1989 (not repealed)',
    'Children Act 1989 (Public Lavatories)',
  ])('keeps %s, which only resembles a title, on the keyword path', (query) => {
    // Normalisation is bounded to punctuation, balanced wrappers and the one
    // recognised terminal annotation. Arbitrary trailing words and
    // parentheticals must leave the query prose.
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('still resolves a held title carrying the tolerated wrappers', () => {
    for (const query of [
      'Equality Act 2010.',
      '"Equality Act 2010"',
      '“Equality Act 2010”',
      'Equality Act 2010 (repealed)',
    ]) {
      expect(classifyLegislationCitation(query, teachesOfAndThe).kind).toBe(
        'act',
      )
    }
  })

  it('never turns a wrapped or punctuated unheld title into a not-held claim', () => {
    for (const query of ['Children Act 1989.', '"Children Act 1989"']) {
      expect(classifyLegislationCitation(query, teachesOfAndThe).kind).not.toBe(
        'not_held',
      )
    }
  })
})

describe('the title-joining grammar is closed', () => {
  it('keeps a title joined by "the" regardless of which titles are stored', () => {
    // Removing the one stored title carrying lowercase `the` used to flip
    // `Offences Against the Person Act 1861` from suppression to keyword
    // search. The grammar must not read the directory.
    const query = 'Offences Against the Person Act 1861'
    const expected = { kind: 'unresolved_title', recognisedQuery: query }
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual(
      expected,
    )
    expect(classifyLegislationCitation(query, teachesOf)).toEqual(expected)
  })

  it('keeps a title joined by "of" regardless of which titles are stored', () => {
    const query = 'Misuse of Drugs Act 1971'
    const expected = { kind: 'unresolved_title', recognisedQuery: query }
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual(
      expected,
    )
    expect(classifyLegislationCitation(query, teachesAnd)).toEqual(expected)
  })

  it('does not adopt a joining word just because a stored title uses it', () => {
    // A title containing lowercase `under` must not put `under` back into the
    // grammar: `Defences under Children Act 1989` is the L35 prose boundary.
    const query = 'Defences under Children Act 1989'
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
    expect(classifyLegislationCitation(query, teachesUnder)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('still suppresses connector-bearing titles with an empty directory', () => {
    // With no stored titles there is no directory evidence at all, so the
    // closed grammar alone keeps an unheld title request suppressed.
    expect(
      classifyLegislationCitation(
        'Misuse of Drugs Act 1971',
        createActDirectory([]),
      ),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 'Misuse of Drugs Act 1971',
    })
  })
})

describe('grammar mutation', () => {
  it('exposes no connector set a caller can mutate', () => {
    const directory = createActDirectory(teachesOfAndTheEntries)
    const before = classifyLegislationCitation(
      'Misuse of Drugs Act 1971',
      directory,
    )
    // Before the repair `titleConnectors()` returned the live internal Set, so
    // deleting `of` from it flipped the connector-bearing title to keyword
    // search. The directory must expose no such handle.
    const mutable = (
      directory as unknown as { titleConnectors?: () => Set<string> }
    ).titleConnectors
    expect(mutable).toBeUndefined()
    expect(
      classifyLegislationCitation('Misuse of Drugs Act 1971', directory),
    ).toEqual(before)
  })

  it('freezes the grammar at runtime', () => {
    // `Object.freeze` is the load-bearing guard, not the `readonly` type:
    // without it a caller could push `under` and silently revert the L35
    // boundary. The cast is the point of the test, not sloppiness.
    expect(Object.isFrozen(legislationTitleJoiningWords)).toBe(true)
    expect(() =>
      (legislationTitleJoiningWords as string[]).push('under'),
    ).toThrow()
    expect(() => {
      ;(legislationTitleJoiningWords as string[])[0] = 'under'
    }).toThrow()
    expect(
      classifyLegislationCitation(
        'Defences under Children Act 1989',
        teachesOfAndThe,
      ),
    ).toEqual({ kind: 'unrecognised' })
  })
})
