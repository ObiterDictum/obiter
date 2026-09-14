import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  decideAuthorityExistence,
  normalizedCitationFromResolution,
  type CitationInput,
  type CitationResolution,
  type NormalizedCitation,
} from '@obiter/verification-core'
import {
  candidates,
  fakePool,
  resolveOne,
  type AuthorityRow,
} from './citation-resolution.test-support'
import {
  resolveCitationCandidate,
  resolveCitationCandidates,
  type CitationCandidate,
} from './citation-resolution'

/**
 * V3's batch boundary, operational failure classification and the seam into the
 * authority-existence check. The properties here are the ones a document-level
 * caller depends on: bounded query count, deterministic ordering, and no path
 * from a non-resolved result into V2 as an identity.
 */

const authorities: AuthorityRow[] = Array.from({ length: 6 }, (_, index) => ({
  documentId: `uksc-2066-${index + 1}`,
  neutralCitation: `[2066] UKSC ${index + 1}`,
}))

describe('batching and query count', () => {
  it('does not perform one query per case-law citation', async () => {
    const { pool, calls } = fakePool({ authorities })
    const batch: CitationCandidate[] = authorities.map((row, index) => ({
      id: `c-${index}`,
      rawText: row.neutralCitation,
    }))

    const results = await resolveCitationCandidates(pool, batch)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.table).toBe('authorities')
    expect(results.map((result) => result.id)).toEqual(
      batch.map((candidate) => candidate.id),
    )
    expect(
      results.every((result) => result.resolution.outcome === 'resolved'),
    ).toBe(true)
  })

  it('loads the Act directory once for a whole document', async () => {
    const { pool, calls } = fakePool({ authorities })
    await resolveCitationCandidates(pool, [
      ...candidates('[2066] UKSC 1', '[2066] UKSC 2'),
      { id: 'a', rawText: 'Test Authority Act 2066' },
      { id: 'b', rawText: 's 1 Test Authority Act 2066' },
      { id: 'c', rawText: '2066 c. 1' },
      { id: 'd', rawText: '/ln/ukpga/2066/1/section/40' },
    ])

    expect(calls.map((call) => call.table)).toEqual([
      'authorities',
      'legislation',
    ])
  })

  it('does not duplicate database work for repeated candidates', async () => {
    const { pool, calls } = fakePool({ authorities })
    const results = await resolveCitationCandidates(
      pool,
      candidates('[2066] UKSC 1', '[2066] UKSC 1', '[2066] UKSC 1'),
    )

    expect(calls).toHaveLength(1)
    expect(
      results.map((result) =>
        result.resolution.outcome === 'resolved' &&
        result.resolution.citation.kind === 'case_law'
          ? result.resolution.citation.sourceId
          : null,
      ),
    ).toEqual(['uksc-2066-1', 'uksc-2066-1', 'uksc-2066-1'])
  })

  it('returns results in input order with the identifiers it was given', async () => {
    const { pool } = fakePool({ authorities })
    const batch: CitationCandidate[] = [
      { id: 'second', rawText: '[2066] UKSC 2' },
      { id: 'first', rawText: '[2066] UKSC 1' },
      { id: 'fourth', rawText: '[2066] UKSC 4' },
    ]

    const results = await resolveCitationCandidates(pool, batch)

    expect(results.map((result) => result.id)).toEqual([
      'second',
      'first',
      'fourth',
    ])
    expect(
      results.map((result) =>
        result.resolution.outcome === 'resolved' &&
        result.resolution.citation.kind === 'case_law'
          ? result.resolution.citation.sourceId
          : null,
      ),
    ).toEqual(['uksc-2066-2', 'uksc-2066-1', 'uksc-2066-4'])
  })

  it('keeps zero, one and many matches distinguishable in one batch', async () => {
    const { pool } = fakePool({
      authorities: [
        ...authorities,
        { documentId: 'dup-a', neutralCitation: '[2066] UKSC 77' },
        { documentId: 'dup-b', neutralCitation: '[2066] UKSC 77' },
      ],
    })
    const results = await resolveCitationCandidates(pool, [
      { id: 'one', rawText: '[2066] UKSC 1' },
      { id: 'zero', rawText: '[2066] UKSC 88' },
      { id: 'many', rawText: '[2066] UKSC 77' },
    ])

    expect(results.map((result) => result.resolution.outcome)).toEqual([
      'resolved',
      'unresolved',
      'ambiguous',
    ])
  })

  it('keeps each authority family on its own resolution path', async () => {
    // A neutral citation cannot resolve to an Act identity and a legislation
    // citation cannot resolve to a judgment: the families never cross.
    const { pool } = fakePool({ authorities })
    const results = await resolveCitationCandidates(pool, [
      { id: 'case-law', rawText: '[2066] UKSC 1' },
      { id: 'act', rawText: 'Test Authority Act 2066' },
      { id: 'path', rawText: '/ln/ukpga/2066/1' },
    ])

    expect(
      results.map((result) =>
        result.resolution.outcome === 'resolved'
          ? result.resolution.citation.kind
          : result.resolution.outcome,
      ),
    ).toEqual(['case_law', 'legislation', 'legislation'])
  })

  it('is safe for an empty batch and queries nothing', async () => {
    const { pool, calls } = fakePool()

    expect(await resolveCitationCandidates(pool, [])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('never places candidate text in SQL, not even as a parameter', async () => {
    const { pool, calls } = fakePool({ authorities })
    const payload = "[2066] UKSC 1'; drop table legal_source_documents; --"
    await resolveCitationCandidates(pool, [
      { id: 'case-law', rawText: '[2066] UKSC 1' },
      { id: 'prose', rawText: payload },
    ])

    const authoritiesCall = calls.find((call) => call.table === 'authorities')
    expect(authoritiesCall?.text).not.toContain('drop table')
    // The candidate itself is never sent: only the year it must contain, which
    // the exact fold still re-checks in Node.
    expect(authoritiesCall?.values).toEqual([['%2066%']])
    for (const call of calls) {
      expect(call.text).not.toContain('[2066] UKSC 1')
      expect(JSON.stringify(call.values)).not.toContain('drop table')
    }
  })
})

describe('operational failures', () => {
  it('reports a failed candidate lookup as inconclusive, never unresolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const resolution = await resolveOne('[2066] UKSC 1', {
      failAuthorities: true,
    })

    expect(resolution).toEqual({
      kind: 'unresolved',
      reason: 'resolution_unavailable',
    })
    expect(resolution).not.toEqual({
      kind: 'unresolved',
      reason: 'no_canonical_match',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('[2066]')
    warn.mockRestore()
  })

  it('resolves the candidates whose dependency answered while others fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pool } = fakePool({ failActs: true })
    const results = await resolveCitationCandidates(pool, [
      { id: 'case-law', rawText: '[2066] UKSC 1' },
      { id: 'path', rawText: '/ln/ukpga/2066/1' },
      { id: 'title', rawText: 'Test Authority Act 2066' },
    ])

    expect(results.map((result) => result.resolution.outcome)).toEqual([
      'unresolved',
      'resolved',
      'inconclusive',
    ])
    warn.mockRestore()
  })

  it('reports a failed Act directory as inconclusive while case law resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pool } = fakePool({ authorities, failActs: true })

    const results = await resolveCitationCandidates(pool, [
      { id: 'case-law', rawText: '[2066] UKSC 1' },
      { id: 'blank', rawText: '   ' },
      { id: 'title', rawText: 'Test Authority Act 2066' },
    ])

    expect(results.map((result) => result.resolution)).toEqual([
      {
        outcome: 'resolved',
        citation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 1',
          sourceId: 'uksc-2066-1',
        },
      },
      { outcome: 'malformed' },
      { outcome: 'inconclusive', reason: 'store_error' },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('Test Authority')
    warn.mockRestore()
  })

  it('reports both failed dependencies as inconclusive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pool } = fakePool({ failAuthorities: true, failActs: true })

    const results = await resolveCitationCandidates(pool, [
      { id: 'case-law', rawText: '[2066] UKSC 1' },
      { id: 'title', rawText: 'Test Authority Act 2066' },
      { id: 'path', rawText: '/ln/ukpga/2066/1' },
    ])

    expect(results.map((result) => result.resolution.outcome)).toEqual([
      'inconclusive',
      'inconclusive',
      'resolved',
    ])
    warn.mockRestore()
  })

  it('propagates a directory that cannot be built instead of calling it a store failure', async () => {
    // A row the fold cannot read is not an unavailable store. Classification
    // stays at the read boundary, so a programmer error is not swallowed into
    // an inconclusive finding.
    const pool = {
      query: async () => ({
        rows: [
          { identity: 'ukpga/2066/1', actType: 'ukpga', year: 2066, number: 1 },
        ],
      }),
    } as unknown as Pick<Pool, 'query'>

    await expect(
      resolveCitationCandidates(pool, candidates('Test Authority Act 2066')),
    ).rejects.toThrow()
  })
})

describe('single candidate boundary', () => {
  it('agrees with the batch for one candidate', async () => {
    const { pool } = fakePool({ authorities })

    expect(
      await resolveCitationCandidate(pool, {
        id: 'one',
        rawText: '[2066] UKSC 1',
      }),
    ).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'case_law',
        neutralCitation: '[2066] UKSC 1',
        sourceId: 'uksc-2066-1',
      },
    })
  })
})

describe('resolution to existence seam', () => {
  const subject = { documentId: 'd-v3', versionId: 'v-1' }
  const citation: CitationInput = {
    rawText: '[2066] UKSC 1',
    location: { paragraphId: 'p-1', start: 0, end: '[2066] UKSC 1'.length },
  }

  /** A non-resolved result carries no identity, so V2 neither reads the store
   * for it nor clears it, and it refuses a store outcome outright. */
  function expectNoIdentityReachesV2(resolution: CitationResolution) {
    expect(resolution.outcome).not.toBe('resolved')
    const normalized: NormalizedCitation =
      normalizedCitationFromResolution(resolution)
    expect(normalized.kind).not.toBe('case_law')
    expect(normalized.kind).not.toBe('legislation')
    const finding = decideAuthorityExistence({
      subject,
      citation,
      normalizedCitation: normalized,
      outcome: { outcome: 'skipped' },
    })
    expect(finding.status.state).not.toBe('clear')
    expect(finding.evidence).toEqual([])
    expect(() =>
      decideAuthorityExistence({
        subject,
        citation,
        normalizedCitation: normalized,
        outcome: { outcome: 'not_held', missing: 'authority' },
      }),
    ).toThrow()
  }

  it('never lets a non-resolved result enter the store as an identity', async () => {
    const { pool } = fakePool({
      authorities: [
        ...authorities,
        { documentId: 'dup-a', neutralCitation: '[2066] UKSC 77' },
        { documentId: 'dup-b', neutralCitation: '[2066] UKSC 77' },
      ],
    })
    const results = await resolveCitationCandidates(pool, [
      { id: 'malformed', rawText: '[2066 UKSC 1' },
      { id: 'unresolved', rawText: '[2066] UKSC 99' },
      { id: 'ambiguous', rawText: '[2066] UKSC 77' },
      { id: 'unsupported', rawText: '/ln/uksi/2010/123' },
      { id: 'title', rawText: 'Some Unstored Act 2066' },
    ])

    expect(
      results.every((result) => result.resolution.outcome !== 'resolved'),
    ).toBe(true)
    for (const result of results) expectNoIdentityReachesV2(result.resolution)

    const { pool: failing } = fakePool({ failAuthorities: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const [inconclusive] = await resolveCitationCandidates(
      failing,
      candidates('[2066] UKSC 1'),
    )
    warn.mockRestore()

    expect(inconclusive?.resolution.outcome).toBe('inconclusive')
    expectNoIdentityReachesV2(inconclusive!.resolution)
  })

  it('lets V2 clear on the identity resolution produced', async () => {
    const { pool } = fakePool({ authorities })
    const [result] = await resolveCitationCandidates(pool, [
      { id: 'one', rawText: '[2066] UKSC 1' },
    ])
    const normalized = normalizedCitationFromResolution(result!.resolution)

    const finding = decideAuthorityExistence({
      subject,
      citation,
      normalizedCitation: normalized,
      outcome: {
        outcome: 'held',
        evidence: [
          {
            sourceType: 'judgment',
            granularity: 'document',
            sourceId: 'uksc-2066-1',
          },
        ],
      },
    })

    expect(finding.status).toEqual({ state: 'clear' })
  })
})
