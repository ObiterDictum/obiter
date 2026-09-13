import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLegislationSearch, readAppliedSearchParameters } from './corpus'

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
    // The serve path answers an ambiguous title with no legislation group and
    // no not-held verdict. Reading only the other two flags would record the
    // response as an ordinary empty keyword result.
    stubFetch({
      outcome: 'legislation_ambiguous',
      groups: [{ key: 'legislation', hits: [] }],
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
    expect(result.legislationNotHeld).toBe(false)
    expect(result.legislationTitleUnresolved).toBe(false)
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
