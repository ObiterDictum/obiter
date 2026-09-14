import { describe, expect, it } from 'vitest'
import {
  candidates,
  fakePool,
  outcomeOf,
  resolveOne,
  type AuthorityRow,
} from './citation-resolution.test-support'
import { resolveCitationCandidates } from './citation-resolution'

/**
 * V3 case-law resolution and grammar rejection against an injected pool. The
 * store's own SQL is pinned in
 * `routes/legal-search/__tests__/authority-citation-lookup.test.ts`; here the
 * fake answers like the real one, so the orchestration is what is under test.
 */

const held: AuthorityRow[] = [
  { documentId: 'uksc-2066-1', neutralCitation: '[2066] UKSC 1' },
  { documentId: 'ewca-civ-2066-7', neutralCitation: '[2066] EWCA Civ 7' },
  { documentId: 'ukut-2066-pad', neutralCitation: '[2066] UKUT 00236 (IAC)' },
]

describe('case law resolution', () => {
  it('resolves a neutral citation to its one stored canonical identity', async () => {
    expect(await resolveOne('[2066] UKSC 1', { authorities: held })).toEqual({
      kind: 'case_law',
      neutralCitation: '[2066] UKSC 1',
      sourceId: 'uksc-2066-1',
    })
  })

  it.each(['[2066]  uksc   1', '[2066] UKSC 1', '[2066]\tUKSC\t1'])(
    'resolves the harmless variants of %j',
    async (rawText) => {
      expect(await resolveOne(rawText, { authorities: held })).toMatchObject({
        kind: 'case_law',
        sourceId: 'uksc-2066-1',
      })
    },
  )

  it('resolves a zero-padded tribunal citation to the unpadded record', async () => {
    expect(
      await resolveOne('[2066] UKUT 236 (IAC)', { authorities: held }),
    ).toMatchObject({ kind: 'case_law', sourceId: 'ukut-2066-pad' })
  })

  it.each([
    '[2065] UKSC 1',
    '[2066] UKHL 1',
    '[2066] UKSC 2',
    '[2066] EWHC 1 (Admin)',
  ])('leaves %j unresolved, never "does not exist"', async (rawText) => {
    // The candidate is inside the grammar and no stored record carries it. That
    // is an absent identity, not an absent authority, and the two must not be
    // conflated.
    expect(await resolveOne(rawText, { authorities: held })).toEqual({
      kind: 'unresolved',
      reason: 'no_canonical_match',
    })
  })

  it('reports two stored records as ambiguous, in either row order', async () => {
    const duplicate: AuthorityRow[] = [
      { documentId: 'uksc-2066-9-a', neutralCitation: '[2066] UKSC 9' },
      { documentId: 'uksc-2066-9-b', neutralCitation: '[2066] UKSC 9' },
    ]
    for (const ordering of [duplicate, [...duplicate].reverse()]) {
      expect(
        await resolveOne('[2066] UKSC 9', { authorities: ordering }),
      ).toEqual({ kind: 'unresolved', reason: 'ambiguous' })
    }
  })

  it('resolves the one live carrier beside withdrawn history, never ambiguous', async () => {
    // A withdrawn row is a source that was once minted and is no longer
    // trustworthy, not a second candidate identity. One live carrier resolves
    // whatever withdrawn history sits beside it, which is what the
    // authority-existence check documents for the same store state.
    expect(
      await resolveOne('[2066] UKSC 8', {
        authorities: [
          { documentId: 'live', neutralCitation: '[2066] UKSC 8' },
          {
            documentId: 'withdrawn',
            neutralCitation: '[2066] UKSC 8',
            withdrawn: true,
          },
        ],
      }),
    ).toEqual({
      kind: 'case_law',
      neutralCitation: '[2066] UKSC 8',
      sourceId: 'live',
    })
  })

  it('stays ambiguous for two live carriers, in either row order', async () => {
    const live: AuthorityRow[] = [
      { documentId: 'live-a', neutralCitation: '[2066] UKSC 8' },
      { documentId: 'live-b', neutralCitation: '[2066] UKSC 8' },
    ]
    for (const rows of [live, [...live].reverse()]) {
      expect(await resolveOne('[2066] UKSC 8', { authorities: rows })).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous',
      })
    }
  })

  it('resolves a single withdrawn carrier and lets V2 judge its trustworthiness', async () => {
    expect(
      await resolveOne('[2066] UKSC 8', {
        authorities: [
          {
            documentId: 'withdrawn',
            neutralCitation: '[2066] UKSC 8',
            withdrawn: true,
          },
        ],
      }),
    ).toEqual({
      kind: 'case_law',
      neutralCitation: '[2066] UKSC 8',
      sourceId: 'withdrawn',
    })
  })

  it('fails closed on two withdrawn carriers it cannot represent as one id', async () => {
    // One sourceId cannot name two withdrawn carriers, and resolution never
    // picks by row order. V2 would report source_withdrawn for the same state;
    // both answers are review-required, so resolution refuses to choose rather
    // than selecting arbitrarily.
    for (const rows of [
      [
        {
          documentId: 'withdrawn-a',
          neutralCitation: '[2066] UKSC 8',
          withdrawn: true,
        },
        {
          documentId: 'withdrawn-b',
          neutralCitation: '[2066] UKSC 8',
          withdrawn: true,
        },
      ],
      [
        {
          documentId: 'withdrawn-b',
          neutralCitation: '[2066] UKSC 8',
          withdrawn: true,
        },
        {
          documentId: 'withdrawn-a',
          neutralCitation: '[2066] UKSC 8',
          withdrawn: true,
        },
      ],
    ]) {
      expect(await resolveOne('[2066] UKSC 8', { authorities: rows })).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous',
      })
    }
  })
})

describe('case law grammar rejection', () => {
  it.each([
    '[2066 UKSC 1',
    '[[2066]] UKSC 1',
    '[2066) UKSC 1',
    '[2066] UKSC',
    '[2066] 1',
    'UKSC 1',
    '[2066] UKSC 1 appended prose',
    '[2066] UKSC 1 and [2066] UKSC 2',
    '[2066] UKSC 1 (No 2)',
    'Confidential Matter v Client [2066] UKSC 1',
    '[２０６６] UKSC 1',
    '[2066] UKSC １',
    '[2066] UКSC 1',
    '[2066] UKSC\u202e 1',
    '[2066] UKSC\u00001',
    '; drop table legal_source_documents',
    '',
    '   ',
  ])('rejects %j as malformed', async (rawText) => {
    expect(await outcomeOf(rawText)).toBe('malformed')
  })

  it('decides what its own grammars reject without reading the store', async () => {
    const { pool, calls } = fakePool()
    const results = await resolveCitationCandidates(
      pool,
      candidates('', '   ', '/ln/ukpga/2066/1/'),
    )

    expect(results.map((result) => result.resolution.outcome)).toEqual([
      'malformed',
      'malformed',
      'malformed',
    ])
    expect(calls).toHaveLength(0)
  })

  it('does not offer a grammar-rejected candidate to the case-law lookup', async () => {
    const { pool, calls } = fakePool()
    await resolveCitationCandidates(
      pool,
      candidates('[2066 UKSC 1', 'UKSC 1', '[2066] UKSC 1 and [2066] UKSC 2'),
    )

    // The legislation classifier decides these, so only its directory is read;
    // none of them is a case-law candidate lookup.
    expect(calls.some((call) => call.table === 'authorities')).toBe(false)
  })

  it('refuses to resolve a case name to the citation it embeds', async () => {
    const { pool } = fakePool({
      authorities: [
        { documentId: 'uksc-2066-1', neutralCitation: '[2066] UKSC 1' },
      ],
    })
    const [result] = await resolveCitationCandidates(
      pool,
      candidates('Carroll v Taylor [2066] UKSC 1'),
    )

    expect(result!.resolution.outcome).toBe('malformed')
  })
})

describe('legislation path resolution', () => {
  it.each([
    ['/ln/ukpga/2066/1', 'ukpga/2066/1', null],
    ['/ln/ukpga/2066/1/section/40', 'ukpga/2066/1', 'section/40'],
    [
      '/ln/ukpga/2066/1/schedule/1/paragraph/4',
      'ukpga/2066/1',
      'schedule/1/paragraph/4',
    ],
  ])(
    'resolves %j by the path grammar alone',
    async (rawText, documentIdentity, labelPath) => {
      const { pool, calls } = fakePool()

      const [result] = await resolveCitationCandidates(
        pool,
        candidates(rawText),
      )

      expect(result!.resolution).toEqual({
        outcome: 'resolved',
        citation: { kind: 'legislation', documentIdentity, labelPath },
      })
      expect(calls).toHaveLength(0)
    },
  )

  it.each(['/ln/uksi/2010/123', '/ln/nia/2010/1', '/ln/flibble/2010/1'])(
    'reports %j as an unsupported source family',
    async (rawText) => {
      expect(await outcomeOf(rawText)).toBe('unsupported')
    },
  )

  it.each([
    '/ln/ukpga/2066',
    '/ln/ukpga/2066/1/',
    '/ln/ukpga/2066/1/../../x',
    '/ln/ukpga/2066/1/section/%2e%2e',
    // A non-canonical Act year is not a canonical path, so it is malformed
    // rather than resolving to an identity Number() would rewrite.
    '/ln/ukpga/0204/1',
    '/ln/ukpga/1800/1',
    'ukpga/2066/1/section/40',
    '/ln/',
    '/ln',
  ])('reports %j as malformed', async (rawText) => {
    expect(await outcomeOf(rawText)).toBe('malformed')
  })

  it('resolves an unsupported family without reading the store', async () => {
    const { pool, calls } = fakePool()
    const [result] = await resolveCitationCandidates(
      pool,
      candidates('/ln/uksi/2010/123'),
    )

    expect(result!.resolution).toEqual({ outcome: 'unsupported' })
    expect(calls).toHaveLength(0)
  })
})

describe('free-text legislation resolution', () => {
  it('resolves a canonical short title to the whole Act', async () => {
    expect(await resolveOne('Test Authority Act 2066')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/1',
      labelPath: null,
    })
  })

  it('resolves a chapter citation the directory holds', async () => {
    expect(await resolveOne('2066 c. 1')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/1',
      labelPath: null,
    })
  })

  it('resolves an unheld chapter to the identity the citation proves', async () => {
    // A chapter citation is a canonical identity in itself, so an absent
    // chapter is a heldness question for the existence check, not a
    // resolution failure.
    expect(await resolveOne('2066 c. 99')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/99',
      labelPath: null,
    })
  })

  it('resolves the one curated alias', async () => {
    expect(await resolveOne('HRA 1998')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/1998/42',
      labelPath: null,
    })
  })

  it('resolves a (repealed) stored title with or without the annotation', async () => {
    for (const rawText of [
      'Repealed Test Act 2066',
      'Repealed Test Act 2066 (repealed)',
    ]) {
      expect(await resolveOne(rawText)).toEqual({
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/5',
        labelPath: null,
      })
    }
  })

  it.each(["Children's Test Act 2066", 'Children\u2019s Test Act 2066'])(
    'folds the apostrophe in %j',
    async (rawText) => {
      expect(await resolveOne(rawText)).toEqual({
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/4',
        labelPath: null,
      })
    },
  )

  it.each(['Co-operative Test Act 2066', 'Cooperative Test Act 2066'])(
    'folds the hyphen in %j through the relaxed key',
    async (rawText) => {
      expect(await resolveOne(rawText)).toEqual({
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/6',
        labelPath: null,
      })
    },
  )

  it('resolves a mixed-case canonical form', async () => {
    expect(await resolveOne('test authority act 2066')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/1',
      labelPath: null,
    })
  })

  it.each([
    ['s 1 Test Authority Act 2066', 'section/1'],
    ['Test Authority Act 2066 s 1', 'section/1'],
    ['section 13(2)(a) Test Authority Act 2066', 'section/13/2/a'],
    ['s 13 subsection 2 Test Authority Act 2066', 'section/13/2'],
    [
      'Schedule 1 paragraph 2 Test Authority Act 2066',
      'schedule/1/paragraph/2',
    ],
    [
      'paragraph 2 Schedule 1 Test Authority Act 2066',
      'schedule/1/paragraph/2',
    ],
    ['Sch. para. 2 Test Authority Act 2066', 'schedule/paragraph/2'],
  ])('keeps the structured provision path for %j', async (rawText, label) => {
    expect(await resolveOne(rawText)).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/1',
      labelPath: label,
    })
  })

  it('leaves a title the directory cannot resolve unresolved, not absent', async () => {
    expect(await resolveOne('Some Unstored Act 2066')).toEqual({
      kind: 'unresolved',
      reason: 'no_canonical_match',
    })
  })

  it('reports an ambiguous folded title as ambiguous', async () => {
    expect(await resolveOne('Duplicate Title Act 2066')).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    })
  })

  it.each([
    'defences under the Test Authority Act 2066',
    'Test Authority Act 2066 as applied',
    'Test Authority Act 2066 (as I read it)',
    'proportionality',
    's 1',
    's 13() Test Authority Act 2066',
    'Act 2066',
    'The powers under Test Authority Act 2066 were amended',
  ])('rejects the prose or malformed candidate %j', async (rawText) => {
    expect(await outcomeOf(rawText)).toBe('malformed')
  })

  it('never resolves a nested title attack to the authority it embeds', async () => {
    const resolution = await resolveOne(
      'Test (Amendment of Test Authority Act 2066) Act 2067',
    )

    expect(resolution).not.toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/1',
      labelPath: null,
    })
    // And it resolves to nothing at all rather than to a guess.
    expect(resolution.kind).toBe('unresolved')
  })

  it('reads the directory once for several free-text candidates', async () => {
    const { pool, calls } = fakePool()
    const results = await resolveCitationCandidates(
      pool,
      candidates('Test Authority Act 2066', 'HRA 1998', '2066 c. 1'),
    )

    expect(calls.map((call) => call.table)).toEqual(['legislation'])
    expect(
      results.every((result) => result.resolution.outcome === 'resolved'),
    ).toBe(true)
  })
})
