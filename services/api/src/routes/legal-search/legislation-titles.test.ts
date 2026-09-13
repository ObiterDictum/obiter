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

// A held amending Act whose own short title embeds another held Act. The
// real corpus holds ukpga/2023/51:
// `Worker Protection (Amendment of Equality Act 2010) Act 2023`.
const nestedHeldEntries = [
  ...held,
  entry(
    2023,
    51,
    'Worker Protection (Amendment of Equality Act 2010) Act 2023',
  ),
]
const nested = createActDirectory(nestedHeldEntries)

describe('nested held-title containment (finding 1)', () => {
  it.each([
    'Worker Protection (Amendment of Equality Act 2010) Act 2010',
    'Worker Protection (Amendment of Equality Act 2010) Act 1901',
    'Worker Protection (Amendment of Equality Act 2010 and Human Rights Act 1998) Act 1999',
    'worker protection (amendment of equality act 2010) act 2010',
    'WORKER PROTECTION (AMENDMENT OF EQUALITY ACT 2010) ACT 2010',
    'Worker Protection (Amendment of Equality Act 2010) Act 2010.',
    '"Worker Protection (Amendment of Equality Act 2010) Act 2010"',
    'Worker Protection (Amendment of Equality Act 2010) Act 2010 (repealed)',
    'Worker Safety (Amendment of Equality Act 2010) Act 2011',
  ])('suppresses the standalone outer title %s', (query) => {
    // The complete run is itself a title phrase, so it is a whole-title
    // request even though a held title sits inside it. Routing it to the
    // keyword path used to serve provisions of the 2023 Act for the 2010
    // (unheld) outer title.
    expect(classifyLegislationCitation(query, nested)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    'Worker Protection (Amendment of Equality Act 2010) Act 2023',
    'Worker Protection (Amendment of Equality Act 2010) Act 2023.',
    '"Worker Protection (Amendment of Equality Act 2010) Act 2023"',
    'Worker Protection (Amendment of Equality Act 2010) Act 2023 (repealed)',
  ])('still resolves the held real-world outer title %s', (query) => {
    const outcome = classifyLegislationCitation(query, nested)
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act')
      expect(outcome.act.identity).toBe('ukpga/2023/51')
  })

  it('still reports an ambiguous outer title as ambiguous', () => {
    const ambiguousOuter = createActDirectory([
      ...nestedHeldEntries,
      entry(
        2022,
        2,
        'Worker Protection (Amendment of Equality Act 2010) Act 2023',
      ),
    ])
    const outcome = classifyLegislationCitation(
      'Worker Protection (Amendment of Equality Act 2010) Act 2023',
      ambiguousOuter,
    )
    expect(outcome.kind).toBe('ambiguous')
  })

  it.each([
    'defences under Worker Protection (Amendment of Equality Act 2010) Act 1999',
    'duties under Worker Protection (Amendment of Equality Act 2010) Act 2023',
    'obligations under Equality Act 2010',
    'the Equality Act 2010 and the Human Rights Act 1998',
    'DUTIES UNDER EQUALITY ACT 2010',
  ])(
    'keeps genuine prose naming a held Act on the keyword path: %s',
    (query) => {
      expect(classifyLegislationCitation(query, nested).kind).toBe(
        'unrecognised',
      )
    },
  )
})

describe('directory lookups are immutable (finding 2)', () => {
  it('returns frozen arrays and frozen entries from every lookup', () => {
    const directory = createActDirectory(teachesOfAndTheEntries)
    const titleList = directory.byNormalizedTitle('equality act 2010')
    expect(titleList).toHaveLength(1)
    expect(Object.isFrozen(titleList)).toBe(true)
    expect(Object.isFrozen(titleList[0])).toBe(true)
    expect(Object.isFrozen(directory.byLooseTitle('equalityact2010'))).toBe(
      true,
    )
    expect(Object.isFrozen(directory.allTitles())).toBe(true)
  })

  it('cannot flip a held title to ambiguous by pushing a fake entry', () => {
    const directory = createActDirectory(teachesOfAndTheEntries)
    const before = classifyLegislationCitation('Equality Act 2010', directory)
    const titleList = directory.byNormalizedTitle('equality act 2010')
    const fake = entry(2020, 99, 'Equality Act 2010')
    const mutable = titleList as LegislationActDirectoryEntry[]
    expect(() => mutable.push(fake)).toThrow()
    expect(() => mutable.splice(0, 0, fake)).toThrow()
    expect(classifyLegislationCitation('Equality Act 2010', directory)).toEqual(
      before,
    )
  })

  it('cannot alter a returned entry or reorder the snapshot', () => {
    const directory = createActDirectory(teachesOfAndTheEntries)
    const before = classifyLegislationCitation('Equality Act 2010', directory)
    const titleList = directory.byNormalizedTitle('equality act 2010')
    const mutable = titleList as LegislationActDirectoryEntry[]
    expect(() => {
      ;(mutable[0] as LegislationActDirectoryEntry).title = 'Fake Act 1999'
    }).toThrow()
    expect(() => {
      mutable[0] = entry(1999, 1, 'Fake Act 1999')
    }).toThrow()
    expect(classifyLegislationCitation('Equality Act 2010', directory)).toEqual(
      before,
    )
  })

  it('cannot fabricate a held resolution through allTitles()', () => {
    const directory = createActDirectory(teachesOfAndTheEntries)
    const all = directory.allTitles() as LegislationActDirectoryEntry[]
    expect(() => all.push(entry(1901, 1, 'Children Act 1901'))).toThrow()
    expect(classifyLegislationCitation('Children Act 1989', directory)).toEqual(
      { kind: 'unresolved_title', recognisedQuery: 'Children Act 1989' },
    )
  })

  it('one caller cannot affect another caller', () => {
    const directory = createActDirectory(teachesOfAndTheEntries)
    const first = directory.byNormalizedTitle('equality act 2010')
    const second = directory.byNormalizedTitle('equality act 2010')
    expect(() =>
      (first as LegislationActDirectoryEntry[]).push(
        entry(2020, 99, 'Equality Act 2010'),
      ),
    ).toThrow()
    expect(second).toHaveLength(1)
    expect(second[0]?.identity).toBe('ukpga/2010/15')
  })

  it('leaves ambiguous lookups ambiguous after attempted mutation', () => {
    const ambiguous = createActDirectory([
      ...teachesOfAndTheEntries,
      entry(2020, 99, 'Equality Act 2010'),
    ])
    const before = classifyLegislationCitation('Equality Act 2010', ambiguous)
    expect(before.kind).toBe('ambiguous')
    const list = ambiguous.byNormalizedTitle('equality act 2010')
    expect(() =>
      (list as LegislationActDirectoryEntry[]).splice(0, 1),
    ).toThrow()
    expect(classifyLegislationCitation('Equality Act 2010', ambiguous)).toEqual(
      before,
    )
  })
})

describe('repeated terminal (repealed) annotation (finding 3)', () => {
  const annotatedEntries = [
    ...held,
    entry(
      2024,
      8,
      'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed)',
    ),
  ]
  const annotated = createActDirectory(annotatedEntries)

  it.each([
    'Safety of Rwanda (Asylum and Immigration) Act 2024',
    'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed)',
    'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed) (repealed)',
    'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed) (repealed).',
    '"Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed) (repealed)"',
    'Safety of Rwanda (Asylum and Immigration) Act 2024 (REPEALED) ( repealed )',
    'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed)(repealed)(repealed)',
  ])('resolves a stored annotated title queried as %s', (query) => {
    const outcome = classifyLegislationCitation(query, annotated)
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act')
      expect(outcome.act.identity).toBe('ukpga/2024/8')
  })

  it.each([
    'Children Act 1989 (repealed) (repealed)',
    'Children Act 1989 (repealed)(repealed)(repealed)',
    'Children Act 1989 (REPEALED)',
    'Children Act 1989 (repealed) (repealed).',
  ])('keeps the unheld repeated annotation a suppression: %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    'Children Act 1989 (Public Lavatories)',
    'Children Act 1989 (amended)',
    'Children Act 1989 (repealed by the Courts Act 2003)',
  ])('leaves an arbitrary terminal parenthetical untouched: %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('resolves all six real annotated titles queried with another annotation', () => {
    const six = createActDirectory([
      entry(2021, 28, 'Health and Social Care Levy Act 2021 (repealed)'),
      entry(
        2021,
        13,
        'Non-Domestic Rating (Public Lavatories) Act 2021 (repealed)',
      ),
      entry(2023, 9, 'Trade (Australia and New Zealand) Act 2023 (repealed)'),
      entry(2023, 39, 'Strikes (Minimum Service Levels) Act 2023 (repealed)'),
      entry(
        2023,
        46,
        'Workers (Predictable Terms and Conditions) Act 2023 (repealed)',
      ),
      entry(
        2024,
        8,
        'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed)',
      ),
    ])
    for (const query of [
      'Health and Social Care Levy Act 2021 (repealed)',
      'Non-Domestic Rating (Public Lavatories) Act 2021 (repealed)',
      'Trade (Australia and New Zealand) Act 2023 (repealed)',
      'Strikes (Minimum Service Levels) Act 2023 (repealed)',
      'Workers (Predictable Terms and Conditions) Act 2023 (repealed)',
      'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed)',
    ]) {
      expect(classifyLegislationCitation(query, six).kind).toBe('act')
    }
  })
})

describe('terminal ", as amended" qualifier (finding 4)', () => {
  it.each([
    'Children Act 1989, as amended',
    'Children Act 1989, as amended.',
    '"Children Act 1989, as amended"',
    'Children Act 1989 ,  As Amended',
    'Children Act 1989, as amended;',
    'Children Act 1989, as amended (repealed)',
  ])('suppresses the unheld qualified title %s', (query) => {
    // A standalone whole-title request with the conventional terminal
    // qualifier must not keyword-serve provisions of unrelated Acts.
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    'Equality Act 2010, as amended',
    'Equality Act 2010, as amended.',
    '"Equality Act 2010, as amended"',
    'Equality Act 2010 , As Amended',
  ])('resolves a held title carrying the qualifier %s', (query) => {
    const outcome = classifyLegislationCitation(query, teachesOfAndThe)
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act')
      expect(outcome.act.identity).toBe('ukpga/2010/15')
  })

  it.each([
    'Children Act 1989, as applied',
    'Children Act 1989, as interpreted',
    'Children Act 1989, as discussed',
    'Children Act 1989, as amended by the Equality Act 2010',
    'Children Act 1989, as amended by Parliament',
    'Children Act 1989, as amended, subject to savings',
  ])('leaves the arbitrary trailing clause %s as prose', (query) => {
    // The supported qualifier is terminal and bounded. A longer clause that
    // merely begins with it is not presentation metadata.
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })
})

// The attached-opener defect: a held title whose first token carries the
// opening bracket read as an unbracketed separate mention, so the query
// reached the keyword path and served provisions of an unrelated Act while
// the whitespace-separated form suppressed. The directory below is the
// minimum that holds the two Acts the regression queries embed.
describe('bracketed contained runs: attached and spaced delimiters (finding 5)', () => {
  it.each([
    [
      'Amendment of (Equality Act 2010) Act 2020',
      'Amendment of ( Equality Act 2010 ) Act 2020',
    ],
    [
      'Changes (Human Rights Act 1998) Act 2020',
      'Changes ( Human Rights Act 1998 ) Act 2020',
    ],
    ['X [Equality Act 2010] Act 2020', 'X [ Equality Act 2010 ] Act 2020'],
    ['X {Equality Act 2010} Act 2020', 'X { Equality Act 2010 } Act 2020'],
    ['X [Equality Act 2010 ] Act 2020', 'X [ Equality Act 2010] Act 2020'],
    ['X ((Equality Act 2010)) Act 2020', 'X (( Equality Act 2010 )) Act 2020'],
  ])(
    'suppresses the attached and spaced forms of %s identically',
    (attached, spaced) => {
      // A space inside the bracket must not decide the routing. Before the
      // fix `depthBefore` was read at the raw token boundary, so only the
      // spaced form reached `unresolved_title`.
      expect(classifyLegislationCitation(attached, teachesOfAndThe)).toEqual({
        kind: 'unresolved_title',
        recognisedQuery: attached,
      })
      expect(classifyLegislationCitation(spaced, teachesOfAndThe)).toEqual({
        kind: 'unresolved_title',
        recognisedQuery: spaced,
      })
    },
  )

  it('never turns the attached-opener form into an authoritative not-held', () => {
    // The suppression must stay a suppression. It may not claim the Act is
    // absent, because the local directory is partial.
    const outcome = classifyLegislationCitation(
      'Amendment of (Equality Act 2010) Act 2020',
      teachesOfAndThe,
    )
    expect(outcome.kind).toBe('unresolved_title')
    expect(
      classifyLegislationCitation('Children Act 1989', teachesOfAndThe),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 'Children Act 1989',
    })
  })

  it.each([
    'X ((Equality Act 2010)) Act 2020',
    'X [[Equality Act 2010]] Act 2020',
    'X {{Equality Act 2010}} Act 2020',
    'X ([Equality Act 2010]) Act 2020',
    'X [{Equality Act 2010}] Act 2020',
  ])('suppresses the nested bracketed form %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    'X (Equality Act 2010) (Human Rights Act 1998) Act 2020',
    'X (Equality Act 2010) [Human Rights Act 1998] Act 2020',
    'X {Equality Act 2010} (Human Rights Act 1998) Act 2020',
  ])('suppresses the multiple bracketed held-title runs in %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    // Balanced, but the opener sits after the title text in its own token, so
    // it must not retroactively bracket the run.
    'X Equality(Act 2010) Act 2020',
    'X Equality[Act 2010] Act 2020',
    // Balanced, but the closer precedes the title text: the earlier group does
    // not surround the run.
    'X (A) Equality Act 2010 Act 2020',
  ])('leaves %s on the keyword path: no opener surrounds the run', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })

  it.each([
    // Mismatched families and unbalanced delimiters are malformed, so they
    // fail conservatively: no unrelated provision may be served.
    'X (Equality Act 2010] Act 2020',
    'X [Equality Act 2010) Act 2020',
    'X {Equality Act 2010] Act 2020',
    'X (Equality Act 2010 Act 2020',
    'X [Equality Act 2010 Act 2020',
    'X {Equality Act 2010 Act 2020',
    'X Equality Act 2010) Act 2020',
    'X Equality Act 2010] Act 2020',
  ])('suppresses the malformed bracket form %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    // Bracketed, but the outer words are not a title phrase, so the held-title
    // mention is prose evidence and the query stays searchable.
    'duties under (Equality Act 2010) Act 2020',
    'Duties under (equality act 2010) Act 2020',
    // The sub-word shares a raw token with the opener. Removing the whole
    // token on partial coverage would discard `under` and read the remainder
    // as a title phrase; the token is kept, so the prose stays searchable.
    'Duties under(equality act 2010) Act 2020',
    'the Equality Act 2010 and the Human Rights Act 1998',
    'Defences under Equality Act 2010',
  ])('keeps genuine prose on the keyword path: %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })
})

// A raw token can straddle the residue and a contained held-title run:
// `under(Equality`, `of{Human`, `under[Children`. The residue must be the
// whole query's folded pieces with the covered run pieces removed, each still
// carrying its own casing. Reading the raw token instead let the covered run
// word's capital (`Equality`, `Children`) count as a name word, and the
// trimmed-away closer then read as an unbalanced bracket, so genuine prose was
// suppressed as a standalone outer title.
describe('straddling-token residue (finding 6)', () => {
  it.each([
    'Duties under(Equality Act 2010)',
    'Duties under (Equality Act 2010)',
    'Duties under(equality act 2010)',
    'Rights under(Equality Act 2010)',
    'Rights under[Equality Act 2010]',
    'Rights under{Equality Act 2010}',
    'Duties under[Equality Act 2010]',
    'Duties under{Equality Act 2010}',
    'Duties under(Equality Act 2010) Act 2020',
    'Duties under[Equality Act 2010] Act 2020',
    'Duties under{Equality Act 2010} Act 2020',
    'Provisions of(Equality Act 2010)',
    'Provisions of (Equality Act 2010)',
    'Provisions of(Human Rights Act 1998)',
    'Provisions of (Human Rights Act 1998)',
    'Provisions of{Human Rights Act 1998}',
    'Provisions of {Human Rights Act 1998}',
  ])('keeps attached-opener prose on the keyword path: %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })

  it.each([
    // A non-held Act glued to the prose word has no covered piece to remove,
    // so the word split, not the casing exclusion, is what keeps it prose.
    'Defences under[Children Act 1989]',
    'Defences under [Children Act 1989]',
    'Defences under(Children Act 1989)',
    'Defences under (Children Act 1989)',
    'Duties under[Children Act 1989] Act 2020',
  ])('keeps a glued non-held mention on the keyword path: %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('reads casing from the uncovered residue only', () => {
    // The covered `Equality` piece must not contribute its capital: the
    // uncovered `under` decides, and it is not a title word.
    expect(
      classifyLegislationCitation(
        'Duties under(Equality Act 2010)',
        teachesOfAndThe,
      ).kind,
    ).toBe('unrecognised')
    // An uncovered capitalised prose word still counts as a name word, so the
    // residue stays a title phrase and the unbalanced opener suppresses it.
    // This is the documented residual: casing still decides when nothing in
    // the residue separates a clause from a title.
    expect(
      classifyLegislationCitation(
        'Duties Under(Equality Act 2010)',
        teachesOfAndThe,
      ).kind,
    ).toBe('unresolved_title')
  })

  it.each([
    // Fabricated outer titles the residue rule must keep suppressing.
    'Worker Safety (Amendment of Equality Act 2010) Act 2011',
    'X ((Equality Act 2010)) Act 2020',
    'X ([Equality Act 2010]) Act 2020',
    'X (Equality Act 2010] Act 2020',
    'X [Equality Act 2010) Act 2020',
    'X {Equality Act 2010] Act 2020',
    'X (Equality Act 2010 Act 2020',
    'X [Equality Act 2010 Act 2020',
    'X Equality Act 2010) Act 2020',
    'X Equality Act 2010] Act 2020',
    'X (Equality Act 2010) (Human Rights Act 1998) Act 2020',
    // Containment on both sides of the held-title span.
    'X(Equality Act 2010)Y Act 2020',
    // Punctuation and quotes around a fabricated outer title.
    '"Worker Safety (Amendment of Equality Act 2010) Act 2011"',
    'Worker Safety (Amendment of Equality Act 2010) Act 2011.',
    // A fragment with no outer year is still title-shaped and stays
    // conservatively suppressed rather than keyword-serving.
    'X (Equality Act 2010)',
  ])('still suppresses the fabricated title-shaped form %s', (query) => {
    expect(classifyLegislationCitation(query, teachesOfAndThe)).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: query,
    })
  })

  it.each([
    ['Duties under(Equality Act 2010)', 'Duties under (Equality Act 2010)'],
    ['Rights under[Equality Act 2010]', 'Rights under [Equality Act 2010]'],
    [
      'Provisions of{Human Rights Act 1998}',
      'Provisions of {Human Rights Act 1998}',
    ],
    [
      'Duties under(Equality Act 2010) Act 2020',
      'Duties under [Equality Act 2010] Act 2020',
    ],
  ])(
    'classifies the attached and spaced forms of %s alike',
    (attached, spaced) => {
      expect(classifyLegislationCitation(attached, teachesOfAndThe)).toEqual(
        classifyLegislationCitation(spaced, teachesOfAndThe),
      )
      expect(classifyLegislationCitation(attached, teachesOfAndThe)).toEqual({
        kind: 'unrecognised',
      })
    },
  )

  it('never turns straddling-token prose into an authoritative not-held', () => {
    for (const query of [
      'Duties under(Equality Act 2010)',
      'Defences under[Children Act 1989]',
      'Provisions of{Human Rights Act 1998}',
    ]) {
      expect(classifyLegislationCitation(query, teachesOfAndThe).kind).not.toBe(
        'not_held',
      )
    }
  })
})
