import { describe, expect, it } from 'vitest'
import {
  classifyLegislationCitation,
  createActDirectory,
} from './legislation-citations'
import { directory } from './legislation-citations.test-support'
describe('determiner-free subject queries (finding 1)', () => {
  // The whole-title gate used to reject only runs containing the/a/an, so a
  // determiner-free subject query passed the gate, failed title resolution,
  // and short-circuited on unresolved_title before keyword search ran. The
  // classification now reads the directory and the query structure instead
  // of a determiner blacklist.
  it.each([
    'duties under Equality Act 2010',
    'duties under the Equality Act 2010',
    'remedies for breach of Human Rights Act 1998',
    'changes introduced by Companies Act 2006',
    'defences under Children Act 1989',
    'offences under Misuse of Drugs Act 1971',
    'sentencing powers in Criminal Justice Act 2003',
    'landlord obligations under Housing Act 2004',
  ])('keeps the realistic subject query %s on the keyword path', (query) => {
    expect(classifyLegislationCitation(query, directory).kind).toBe(
      'unrecognised',
    )
  })

  it('never lets a held Act title inside a longer query be discarded', () => {
    // A held title is directory evidence that the query names something
    // other than (or more than) that title: the extra text is the query, so
    // the whole query stays a subject search and is never unresolved_title.
    for (const query of [
      'duties under Equality Act 2010',
      'remedies for breach of Human Rights Act 1998',
      'the Equality Act 2010 and the Human Rights Act 1998',
    ]) {
      expect(classifyLegislationCitation(query, directory).kind).toBe(
        'unrecognised',
      )
    }
  })

  it('does not treat an underspecified fragment as a title request', () => {
    expect(classifyLegislationCitation('Act 2020', directory)).toEqual({
      kind: 'unrecognised',
    })
    expect(classifyLegislationCitation('the Act 2020', directory)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('still reports an unresolved whole-title request', () => {
    // The subject-query fix must not turn a genuine whole-title request into
    // a keyword search: the directory cannot prove the Act absent, so the
    // state suppresses keyword neighbours without claiming absence.
    expect(classifyLegislationCitation('Children Act 1989', directory)).toEqual(
      { kind: 'unresolved_title', recognisedQuery: 'Children Act 1989' },
    )
    expect(
      classifyLegislationCitation('Companies Act 2006', directory),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 'Companies Act 2006',
    })
    expect(
      classifyLegislationCitation('Landlord and Tenant Act 1985', directory),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 'Landlord and Tenant Act 1985',
    })
  })

  it('resolves a held title before classifying it as prose', () => {
    expect(
      classifyLegislationCitation('Equality Act 2010', directory).kind,
    ).toBe('act')
    expect(
      classifyLegislationCitation('the Equality Act 2010', directory).kind,
    ).toBe('act')
  })

  it('keeps an unheld title whose name wraps a known connector', () => {
    // "Misuse of Drugs" is an unheld whole-title request, not prose: a
    // directory token between two unknown nouns is how short titles are
    // built, so the run must stay a title request.
    expect(
      classifyLegislationCitation('Misuse of Drugs Act 1971', directory),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 'Misuse of Drugs Act 1971',
    })
  })
})

describe('prose classification is structural, not casing-led (L35)', () => {
  // The determiner-free repair still read the case of the first token as
  // evidence about the whole query, so "Defences under Children Act 1989" was
  // a title request while its lowercase twin was prose. Each pair must route
  // identically: a clause with leading words before the capitalised title
  // phrase is prose whatever the sentence-initial case.
  it.each([
    ['Defences under Children Act 1989', 'defences under Children Act 1989'],
    ['Duties under Equality Act 2010', 'duties under Equality Act 2010'],
    ['DUTIES UNDER EQUALITY ACT 2010', 'duties under Equality Act 2010'],
    [
      'Sentencing powers in Criminal Justice Act 2003',
      'sentencing powers in Criminal Justice Act 2003',
    ],
  ])(
    'routes the sentence-initial form %s as its lowercase twin %s',
    (sentenceInitial, lowercase) => {
      const initial = classifyLegislationCitation(sentenceInitial, directory)
      const plain = classifyLegislationCitation(lowercase, directory)
      expect(initial.kind).toBe('unrecognised')
      expect(plain.kind).toBe('unrecognised')
      expect(initial.kind).toBe(plain.kind)
    },
  )

  it('keeps a held Act named inside prose eligible for keyword search', () => {
    // Directory containment alone is not the rule: the phrase boundary must
    // leave the held title reachable in both casings.
    for (const query of [
      'Duties under Equality Act 2010',
      'duties under Equality Act 2010',
    ]) {
      expect(classifyLegislationCitation(query, directory).kind).toBe(
        'unrecognised',
      )
    }
  })

  it('still suppresses a genuine whole-title request the directory does not hold', () => {
    // The repair must not turn every Act-shaped query into prose. A whole-title
    // request that resolves to nothing stays on the honest suppression path, so
    // unrelated provisions are never served as its answer.
    for (const query of [
      'Children Act 1989',
      'children act 1989',
      'Companies Act 2006',
      'Landlord and Tenant Act 1985',
    ]) {
      expect(classifyLegislationCitation(query, directory)).toEqual({
        kind: 'unresolved_title',
        recognisedQuery: query,
      })
    }
  })

  it('keeps an underspecified fragment on the no-claim path', () => {
    // "Act 2020" and "the Act 2020" carry no title words, so they can make no
    // claim at all: not unresolved-title, not not-held.
    for (const query of ['Act 2020', 'the Act 2020']) {
      expect(classifyLegislationCitation(query, directory)).toEqual({
        kind: 'unrecognised',
      })
    }
  })

  it('never asserts an exact Act, provision or not-held for a bare fragment', () => {
    // These cannot be told apart from a lowercased whole-title request without
    // a lexicon, so they stay on the safe suppression path. The invariant is
    // the absence of a legal assertion, not the routing.
    for (const query of [
      'this Act 2020',
      'section 5 applies under the Act 2020',
    ]) {
      const outcome = classifyLegislationCitation(query, directory)
      expect(['not_held', 'act', 'provision']).not.toContain(outcome.kind)
    }
  })

  it('keeps a held title that carries a terminal status annotation held', () => {
    const repealed = createActDirectory([
      {
        actType: 'ukpga',
        year: 2021,
        number: 28,
        identity: 'ukpga/2021/28',
        title: 'Health and Social Care Levy Act 2021 (repealed)',
      },
    ])
    const outcome = classifyLegislationCitation(
      'Health and Social Care Levy Act 2021',
      repealed,
    )
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act') {
      expect(outcome.act.identity).toBe('ukpga/2021/28')
    }
  })

  it('keeps a title whose name wraps a known connector a title request', () => {
    // "Misuse of Drugs" is unheld, and its middle word is a directory
    // connector, so the whole run is a title phrase, not a clause.
    expect(
      classifyLegislationCitation('Misuse of Drugs Act 1971', directory),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 'Misuse of Drugs Act 1971',
    })
  })
})
