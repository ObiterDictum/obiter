import { describe, expect, it, vi } from 'vitest'
import {
  combineUriChecks,
  classifyUriResponse,
  createWithdrawalDeps,
  evaluateWithdrawal,
  runWithdrawalCheck,
  type UriCheck,
  type WithdrawalCheckDeps,
} from './withdrawal-check'
import type { Db } from './bulk-ingest'

const baseUrl = 'https://caselaw.nationalarchives.gov.uk'

interface RecordedQuery {
  text: string
  params: unknown[]
}

function fakePool(
  handler: (text: string, params: unknown[]) => { rows: unknown[] },
) {
  const queries: RecordedQuery[] = []
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params })
      return handler(text, params) as { rows: never[] }
    },
  } as unknown as Db
  return { pool, queries }
}

function storedRow(providerJson: unknown = {}) {
  return {
    document_id: 'uksc-2024-99',
    source_uri: '/uksc/2024/99',
    xml_uri: '/uksc/2024/99/data.xml',
    provider_json: providerJson,
  }
}

function setup(
  rows: unknown[],
  fetchImpl: typeof fetch,
  now = () => Date.parse('2026-09-01T00:00:00Z'),
) {
  const { pool, queries } = fakePool((text) =>
    text.includes('from legal_source_documents')
      ? { rows: rows.splice(0) as never[] }
      : { rows: [] },
  )
  const deleteFromIndex = vi.fn(async (_ids: string[]) => {})
  const deps: WithdrawalCheckDeps = {
    ...createWithdrawalDeps(pool, baseUrl, 'run-1', 1000, deleteFromIndex, {
      gapMs: 0,
      sleep: async () => {},
      fetchImpl,
      now,
      pageSize: 50,
      timeoutMs: 1000,
    }),
  }
  return { deps, queries, deleteFromIndex }
}

function fetchMap(entries: Record<string, Response | Error>) {
  return (async (url: string | URL | Request) => {
    const result = entries[String(url)]
    if (result instanceof Error) throw result
    if (result) return result
    throw new Error(`unstubbed fetch ${String(url)}`)
  }) as typeof fetch
}

const notFoundPage = new Response('Page not found - Find Case Law', {
  status: 404,
})
const okPage = new Response('<article>judgment</article>', { status: 200 })

function updates(queries: RecordedQuery[]) {
  return queries.filter((query) => query.text.includes('update'))
}

describe('classifyUriResponse', () => {
  it('treats 429 and 5xx as inconclusive, never as withdrawal evidence', () => {
    expect(classifyUriResponse(429, 'Page not found')).toBe('inconclusive')
    expect(classifyUriResponse(503, 'Page not found')).toBe('inconclusive')
  })

  it('treats a bare 404 without the provider marker as inconclusive', () => {
    expect(classifyUriResponse(404, '<html>proxy error</html>')).toBe(
      'inconclusive',
    )
    expect(classifyUriResponse(404, null)).toBe('inconclusive')
  })

  it('treats a marked 404 as not_found and 2xx as present', () => {
    expect(classifyUriResponse(404, 'Page not found - Find Case Law')).toBe(
      'not_found',
    )
    expect(classifyUriResponse(200, null)).toBe('present')
  })
})

describe('combineUriChecks', () => {
  const check = (outcome: UriCheck['outcome']): UriCheck => ({
    uri: '/x',
    outcome,
    httpStatus: 200,
    bodySnippetHash: null,
  })

  it('treats an empty check set as inconclusive, never a loss signal', () => {
    expect(combineUriChecks([])).toBe('inconclusive')
  })

  it('needs every URI definitively gone before signalling double loss', () => {
    expect(combineUriChecks([check('not_found'), check('not_found')])).toBe(
      'double_not_found',
    )
    expect(combineUriChecks([check('not_found'), check('present')])).toBe(
      'single_not_found',
    )
    expect(combineUriChecks([check('present'), check('present')])).toBe(
      'present',
    )
    expect(combineUriChecks([check('not_found'), check('inconclusive')])).toBe(
      'inconclusive',
    )
  })
})

describe('evaluateWithdrawal', () => {
  const oldCandidate = {
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    runId: 'run-0',
    checkedUris: ['/uksc/2024/99'],
  }

  it('never confirms on a single-URI signal', () => {
    expect(
      evaluateWithdrawal(oldCandidate, 'single_not_found', Date.now(), 'run-1'),
    ).toBe('none')
    expect(
      evaluateWithdrawal(null, 'single_not_found', Date.now(), 'run-1'),
    ).toBe('mark_candidate')
  })

  it('confirms a double loss only on a later run past the gap', () => {
    const now = Date.parse('2026-09-01T00:00:00Z')
    expect(evaluateWithdrawal(null, 'double_not_found', now, 'run-1')).toBe(
      'mark_candidate',
    )
    expect(
      evaluateWithdrawal(oldCandidate, 'double_not_found', now, 'run-0'),
    ).toBe('none')
    expect(
      evaluateWithdrawal(
        { ...oldCandidate, firstSeenAt: '2026-08-31T12:00:00.000Z' },
        'double_not_found',
        now,
        'run-1',
      ),
    ).toBe('none')
    expect(
      evaluateWithdrawal(oldCandidate, 'double_not_found', now, 'run-1'),
    ).toBe('mark_withdrawn')
  })

  it('confirms a repeated single-404 only for single-URI rows', () => {
    const now = Date.parse('2026-09-01T00:00:00Z')
    expect(
      evaluateWithdrawal(oldCandidate, 'single_not_found', now, 'run-1', {
        singleUri: true,
      }),
    ).toBe('mark_withdrawn')
    expect(
      evaluateWithdrawal(oldCandidate, 'single_not_found', now, 'run-1'),
    ).toBe('none')
    expect(
      evaluateWithdrawal(
        { ...oldCandidate, firstSeenAt: '2026-08-31T12:00:00.000Z' },
        'single_not_found',
        now,
        'run-1',
        { singleUri: true },
      ),
    ).toBe('none')
  })
})

describe('runWithdrawalCheck', () => {
  it('leaves the row untouched when the fetch throws', async () => {
    const { deps, queries } = setup(
      [storedRow()],
      fetchMap({
        [`${baseUrl}/uksc/2024/99`]: new Error('dns failure'),
      }),
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.inconclusive).toBe(1)
    expect(report.withdrawn).toEqual([])
    expect(updates(queries)).toEqual([])
    expect(
      queries.filter((query) =>
        query.text.includes('insert into legal_source_withdrawal_audits'),
      ),
    ).toHaveLength(2)
  })

  it('leaves the row untouched on timeout', async () => {
    const hanging = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation timed out', 'TimeoutError')),
        )
      })) as typeof fetch
    const { deps, queries } = setup([storedRow()], hanging)

    const report = await runWithdrawalCheck(deps)

    expect(report.inconclusive).toBe(1)
    expect(updates(queries)).toEqual([])
  })

  it('leaves the row untouched on 429 and 5xx', async () => {
    for (const status of [429, 503]) {
      const { deps, queries } = setup(
        [storedRow()],
        fetchMap({
          [`${baseUrl}/uksc/2024/99`]: new Response('limited', { status }),
          [`${baseUrl}/uksc/2024/99/data.xml`]: okPage.clone(),
        }),
      )

      const report = await runWithdrawalCheck(deps)

      expect(report.inconclusive).toBe(1)
      expect(updates(queries)).toEqual([])
    }
  })

  it('marks a candidate, never withdrawn, on a single definitive 404', async () => {
    const { deps, queries, deleteFromIndex } = setup(
      [storedRow()],
      fetchMap({
        [`${baseUrl}/uksc/2024/99`]: notFoundPage.clone(),
        [`${baseUrl}/uksc/2024/99/data.xml`]: okPage.clone(),
      }),
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.candidates).toBe(1)
    expect(report.withdrawn).toEqual([])
    expect(deleteFromIndex).not.toHaveBeenCalled()
    const [update] = updates(queries)
    const singlePayload = JSON.parse(update.params[1] as string) as Record<
      string,
      unknown
    >
    expect(singlePayload).toHaveProperty('withdrawalCandidate')
    expect(singlePayload).not.toHaveProperty('withdrawn')
  })

  it('marks a candidate on the first double 404 without touching the index', async () => {
    const { deps, queries, deleteFromIndex } = setup(
      [storedRow()],
      fetchMap({
        [`${baseUrl}/uksc/2024/99`]: notFoundPage.clone(),
        [`${baseUrl}/uksc/2024/99/data.xml`]: notFoundPage.clone(),
      }),
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.candidates).toBe(1)
    expect(report.withdrawn).toEqual([])
    expect(deleteFromIndex).not.toHaveBeenCalled()
    expect(updates(queries)).toHaveLength(1)
  })

  it('withdraws on a second double 404 past the gap and removes the derived copy', async () => {
    const candidate = {
      withdrawalCandidate: {
        firstSeenAt: '2026-08-01T00:00:00.000Z',
        runId: 'run-0',
        checkedUris: ['/uksc/2024/99', '/uksc/2024/99/data.xml'],
      },
    }
    const { deps, queries, deleteFromIndex } = setup(
      [storedRow(candidate)],
      fetchMap({
        [`${baseUrl}/uksc/2024/99`]: notFoundPage.clone(),
        [`${baseUrl}/uksc/2024/99/data.xml`]: notFoundPage.clone(),
      }),
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.withdrawn).toEqual(['uksc-2024-99'])
    expect(deleteFromIndex).toHaveBeenCalledWith(['uksc-2024-99'])
    const [update] = updates(queries)
    expect(update.text).toContain(`- 'withdrawalCandidate'`)
    const payload = JSON.parse(update.params[1] as string) as {
      withdrawn: { runIds: string[] }
    }
    expect(payload.withdrawn.runIds).toEqual(['run-0', 'run-1'])
  })

  it('an interrupted run deletes nothing', async () => {
    const { pool, queries } = fakePool((text) => {
      if (text.includes('from legal_source_documents')) {
        return { rows: [storedRow(), storedRow()] }
      }
      if (text.includes('legal_source_withdrawal_audits')) {
        throw new Error('connection lost mid-run')
      }
      return { rows: [] }
    })
    const deps: WithdrawalCheckDeps = {
      ...createWithdrawalDeps(pool, baseUrl, 'run-1', 1000, async () => {}, {
        gapMs: 0,
        sleep: async () => {},
        fetchImpl: fetchMap({
          [`${baseUrl}/uksc/2024/99`]: okPage.clone(),
          [`${baseUrl}/uksc/2024/99/data.xml`]: okPage.clone(),
        }),
        pageSize: 50,
        timeoutMs: 1000,
      }),
    }

    await expect(runWithdrawalCheck(deps)).rejects.toThrow('connection lost')
    expect(queries.some((query) => /delete\s+from/i.test(query.text))).toBe(
      false,
    )
    expect(
      queries.some(
        (query) =>
          query.text.includes('update') && query.text.includes('withdrawn'),
      ),
    ).toBe(false)
  })

  it('clears a stale candidate when the document is present again', async () => {
    const candidate = {
      withdrawalCandidate: {
        firstSeenAt: '2026-08-01T00:00:00.000Z',
        runId: 'run-0',
        checkedUris: ['/uksc/2024/99', '/uksc/2024/99/data.xml'],
      },
    }
    const { deps, queries, deleteFromIndex } = setup(
      [storedRow(candidate)],
      fetchMap({
        [`${baseUrl}/uksc/2024/99`]: okPage.clone(),
        [`${baseUrl}/uksc/2024/99/data.xml`]: okPage.clone(),
      }),
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.present).toBe(1)
    expect(report.candidates).toBe(0)
    expect(report.withdrawn).toEqual([])
    expect(deleteFromIndex).not.toHaveBeenCalled()
    // The candidate is dropped, so a later double-404 restarts the
    // two-run clock instead of withdrawing on the stale observation.
    const [update] = updates(queries)
    expect(update.text).toContain(`- 'withdrawalCandidate'`)
    expect(
      evaluateWithdrawal(
        null,
        'double_not_found',
        Date.parse('2026-09-02T00:00:00Z'),
        'run-2',
      ),
    ).toBe('mark_candidate')
  })

  it('keeps the candidate untouched on an inconclusive run', async () => {
    const candidate = {
      withdrawalCandidate: {
        firstSeenAt: '2026-08-01T00:00:00.000Z',
        runId: 'run-0',
        checkedUris: ['/uksc/2024/99', '/uksc/2024/99/data.xml'],
      },
    }
    const { deps, queries } = setup(
      [storedRow(candidate)],
      fetchMap({
        [`${baseUrl}/uksc/2024/99`]: new Response('limited', { status: 429 }),
        [`${baseUrl}/uksc/2024/99/data.xml`]: okPage.clone(),
      }),
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.inconclusive).toBe(1)
    expect(updates(queries)).toEqual([])
  })

  it('confirms a single-URI row on a repeated single 404 past the gap', async () => {
    const singleUriRow = {
      document_id: 'uksc-2024-99',
      source_uri: '/uksc/2024/99',
      xml_uri: null,
      provider_json: {},
    }
    const first = setup(
      [singleUriRow],
      fetchMap({ [`${baseUrl}/uksc/2024/99`]: notFoundPage.clone() }),
    )

    const firstReport = await runWithdrawalCheck(first.deps)

    expect(firstReport.candidates).toBe(1)
    expect(firstReport.withdrawn).toEqual([])
    expect(first.deleteFromIndex).not.toHaveBeenCalled()

    const candidate = {
      withdrawalCandidate: {
        firstSeenAt: '2026-08-01T00:00:00.000Z',
        runId: 'run-0',
        checkedUris: ['/uksc/2024/99'],
      },
    }
    const second = setup(
      [
        {
          document_id: 'uksc-2024-99',
          source_uri: '/uksc/2024/99',
          xml_uri: null,
          provider_json: candidate,
        },
      ],
      fetchMap({ [`${baseUrl}/uksc/2024/99`]: notFoundPage.clone() }),
    )

    const secondReport = await runWithdrawalCheck(second.deps)

    expect(secondReport.withdrawn).toEqual(['uksc-2024-99'])
    expect(second.deleteFromIndex).toHaveBeenCalledWith(['uksc-2024-99'])
  })

  it('never fetches off-origin absolute URIs and treats them as inconclusive', async () => {
    const fetchImpl = vi.fn(async () => okPage.clone()) as typeof fetch
    const { deps, queries } = setup(
      [
        {
          document_id: 'uksc-2024-99',
          source_uri: 'https://evil.example/phish',
          xml_uri: null,
          provider_json: {},
        },
      ],
      fetchImpl,
    )

    const report = await runWithdrawalCheck(deps)

    expect(report.inconclusive).toBe(1)
    expect(report.withdrawn).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updates(queries)).toEqual([])
  })

  it('does not follow redirects: a 3xx is inconclusive, never present', async () => {
    const seenInits: unknown[] = []
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seenInits.push(init)
      return new Response('', {
        status: 301,
        headers: { location: 'https://caselaw.nationalarchives.gov.uk/live' },
      })
    }) as typeof fetch
    const { deps, queries } = setup([storedRow()], fetchImpl)

    const report = await runWithdrawalCheck(deps)

    expect(report.inconclusive).toBe(1)
    expect(report.present).toBe(0)
    expect(report.withdrawn).toEqual([])
    expect(updates(queries)).toEqual([])
    expect(seenInits.length).toBeGreaterThan(0)
    for (const init of seenInits) {
      expect(init).toMatchObject({ redirect: 'manual' })
    }
  })
})
