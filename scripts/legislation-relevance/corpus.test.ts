import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertRunnerProvenance,
  fetchLegislationSearch,
  legislationReportProvenance,
  readAppliedSearchParameters,
  readRunnerProvenance,
} from './corpus'

function stubFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('legislation relevance corpus boundary', () => {
  it('observes an ambiguous legislation terminal from the served response', async () => {
    // The serve path answers an ambiguous title with no legislation group at
    // all (the emitted `groups` array is empty, so the key is absent) and no
    // not-held verdict. Reading only the other two flags would record the
    // response as an ordinary empty keyword result.
    stubFetch({
      outcome: 'legislation_ambiguous',
      diagnostics: {
        legislationAmbiguous: true,
        legislationNote:
          'The title names more than one stored Act. Candidates: A; B',
      },
    })
    const result = await fetchLegislationSearch(
      'http://127.0.0.1:8787',
      'Renters Rights Act 2025',
    )
    expect(result.legislationAmbiguous).toBe(true)
    expect(result.hits).toEqual([])
    expect(result.legislationNotHeld).toBe(false)
    expect(result.legislationTitleUnresolved).toBe(false)
  })

  it('still reads a normal response that carries a legislation group', async () => {
    stubFetch({
      outcome: 'ok',
      groups: [
        {
          key: 'legislation',
          hits: [
            {
              id: 'hit-1',
              documentIdentity: 'ukpga/1998/42',
              labelPath: 'section/6',
              title: 'Human Rights Act 1998',
            },
          ],
        },
      ],
      diagnostics: { legislationSearchParameters: { matchingStrategy: 'all' } },
    })
    const result = await fetchLegislationSearch(
      'http://127.0.0.1:8787',
      's. 6 Human Rights Act 1998',
    )
    expect(result.hits.map((hit) => hit.documentIdentity)).toEqual([
      'ukpga/1998/42',
    ])
    expect(result.legislationAmbiguous).toBe(false)
  })

  it('reads the parameters the server reported applying', () => {
    expect(
      readAppliedSearchParameters({
        matchingStrategy: 'all',
        rankingScoreThreshold: 0.35,
      }),
    ).toEqual({ matchingStrategy: 'all', rankingScoreThreshold: 0.35 })
    // An explicit null is a real value: the server applied no floor.
    expect(
      readAppliedSearchParameters({
        matchingStrategy: 'all',
        rankingScoreThreshold: null,
      }),
    ).toEqual({ matchingStrategy: 'all', rankingScoreThreshold: null })
  })

  it('rejects a report that does not state what it applied', () => {
    // A missing field is not "no floor". An absent observation must stay
    // absent so run.ts refuses, rather than being recorded as a condition.
    expect(readAppliedSearchParameters(undefined)).toBe(null)
    expect(readAppliedSearchParameters(null)).toBe(null)
    expect(readAppliedSearchParameters({ matchingStrategy: 'all' })).toBe(null)
    expect(readAppliedSearchParameters({ rankingScoreThreshold: 0.35 })).toBe(
      null,
    )
    expect(
      readAppliedSearchParameters({
        matchingStrategy: 'all',
        rankingScoreThreshold: 'none',
      }),
    ).toBe(null)
  })
})

describe('legislation relevance report provenance', () => {
  it('records the runner and the measured API as distinct identities', () => {
    const provenance = legislationReportProvenance(
      { checkoutRoot: '/src/runner', commitSha: 'a96918c' },
      { checkoutRoot: '/src/api', commitSha: '231508a' },
    )
    expect(provenance.runnerCommitSha).toBe('a96918c')
    expect(provenance.apiCommitSha).toBe('231508a')
    expect(provenance.runnerCheckoutRoot).toBe('/src/runner')
    expect(provenance.apiCheckoutRoot).toBe('/src/api')
    // Neither SHA may be collapsed into an ownerless field.
    expect(provenance.runnerCommitSha).not.toBe(provenance.apiCommitSha)
    expect('commitSha' in provenance).toBe(false)
  })

  it('labels both identities independently even when the SHAs coincide', () => {
    const provenance = legislationReportProvenance(
      { checkoutRoot: '/src/runner', commitSha: 'a96918c' },
      { checkoutRoot: '/src/api', commitSha: 'a96918c' },
    )
    // Equal-by-coincidence is still labelled twice; the report never infers
    // one from the other.
    expect(provenance.runnerCommitSha).toBe('a96918c')
    expect(provenance.apiCommitSha).toBe('a96918c')
    expect(provenance.runnerCheckoutRoot).toBe('/src/runner')
    expect(provenance.apiCheckoutRoot).toBe('/src/api')
  })

  it('cannot let missing runner provenance masquerade as API provenance', async () => {
    // A runner with no git metadata records null, not the API's SHA.
    const unavailable = legislationReportProvenance(
      { checkoutRoot: null, commitSha: null },
      { checkoutRoot: '/src/api', commitSha: '231508a' },
    )
    expect(unavailable.runnerCommitSha).toBe(null)
    expect(unavailable.runnerCheckoutRoot).toBe(null)
    expect(unavailable.apiCommitSha).toBe('231508a')
    expect(() =>
      assertRunnerProvenance({ checkoutRoot: null, commitSha: null }),
    ).toThrow(/runner commit/i)
    // Reading a directory that is not a git checkout yields no identity at
    // all rather than borrowing one.
    const observed = await readRunnerProvenance(tmpdir())
    expect(observed.commitSha).toBe(null)
    expect(observed.checkoutRoot).toBe(null)
  })

  it('records the runner commit it actually read from the checkout', async () => {
    const observed = await readRunnerProvenance(process.cwd())
    expect(observed.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(observed.checkoutRoot).toBeTruthy()
  })
})
