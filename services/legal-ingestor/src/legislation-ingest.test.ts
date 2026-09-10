import { describe, expect, it, vi } from 'vitest'
import {
  ingestOneAct,
  ingestYear,
  nextFeedPageUrl,
  parseLegislationIngestArgs,
  readUnappliedEffects,
  resolveRequestGapMs,
  upsertLegislationDocument,
  type Db,
  type LegislationIngestDeps,
} from './legislation-ingest'
import {
  parseYearFeed,
  sha256Hex,
  type IngestDocument,
} from './legislation-clml'

// Year feeds page at 20 entries: page 1 of 2020 ends at c.10, so a scope
// that reads only the first page silently drops c.1-9. This pins the
// two-page walk contract (collect across rel=next, then dedupe by number).
describe('year feed paging', () => {
  const page = (ids: string, next: string | null) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${ids}
${next ? `<link rel="next" type="application/atom+xml" href="${next}"/>` : ''}
</feed>`

  it('collects entries across pages via rel=next', () => {
    const entry = (n: number) =>
      `<entry><id>http://www.legislation.gov.uk/id/ukpga/2020/${n}</id><title>Act ${n}</title></entry>`
    const page1 = page(
      [10, 11, 12].map(entry).join(''),
      'http://www.legislation.gov.uk/ukpga/2020/data.feed?page=2&amp;foo=1',
    )
    const page2 = page([1, 2].map(entry).join(''), null)

    expect(nextFeedPageUrl(page1)).toBe(
      'http://www.legislation.gov.uk/ukpga/2020/data.feed?page=2&foo=1',
    )
    expect(nextFeedPageUrl(page2)).toBeNull()
    const acts = [...parseYearFeed(page1, 2020), ...parseYearFeed(page2, 2020)]
    expect(acts.map((act) => act.number).sort((a, b) => a - b)).toEqual([
      1, 2, 10, 11, 12,
    ])
  })
})

describe('parseLegislationIngestArgs', () => {
  it('parses --help and -h without options', () => {
    expect(parseLegislationIngestArgs(['--help'])).toEqual({
      ok: true,
      help: true,
    })
    expect(parseLegislationIngestArgs(['-h'])).toEqual({
      ok: true,
      help: true,
    })
  })

  it('rejects unrecognised flags and positionals instead of ignoring them', () => {
    expect(parseLegislationIngestArgs(['--skip-effekts']).ok).toBe(false)
    expect(parseLegislationIngestArgs(['ukpga/2020/1']).ok).toBe(false)
    expect(parseLegislationIngestArgs(['--years']).ok).toBe(false)
  })

  it('accepts bare --skip-effects and validates the rest', () => {
    const bare = parseLegislationIngestArgs(['--skip-effects'])
    if (!bare.ok || bare.help) throw new Error('expected options')
    expect(bare.options.skipEffects).toBe(true)
    const explicit = parseLegislationIngestArgs(['--skip-effects=0'])
    if (!explicit.ok || explicit.help) throw new Error('expected options')
    expect(explicit.options.skipEffects).toBe(false)
    expect(parseLegislationIngestArgs(['--skip-effects=maybe']).ok).toBe(false)
    const act = parseLegislationIngestArgs(['--act=ukpga/2023/29'])
    if (!act.ok || act.help) throw new Error('expected options')
    expect(act.options.act).toMatchObject({
      actType: 'ukpga',
      year: 2023,
      number: 29,
    })
    expect(parseLegislationIngestArgs(['--act=nope']).ok).toBe(false)
    expect(parseLegislationIngestArgs(['--max-acts=0']).ok).toBe(false)
    expect(parseLegislationIngestArgs(['--years=2020,abc']).ok).toBe(false)
  })
})

describe('resolveRequestGapMs', () => {
  it('falls back to the 5s floor for non-numeric input', () => {
    expect(resolveRequestGapMs('abc', 5)).toBe(5000)
    expect(resolveRequestGapMs('NaN', null)).toBe(5000)
  })

  it('honours a finite value above the crawl-delay floor', () => {
    expect(resolveRequestGapMs('10000', 5)).toBe(10000)
    expect(resolveRequestGapMs('1000', 5)).toBe(5000)
    expect(resolveRequestGapMs(undefined, null)).toBe(5000)
  })
})

describe('upsertLegislationDocument transaction', () => {
  const doc: IngestDocument = {
    identity: 'ukpga/2020/1',
    actType: 'ukpga',
    year: 2020,
    number: 1,
    title: 'Sample Act 2020',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2020/1',
    contentHash: 'hash-1',
    extent: 'E+W',
    declaredProvisions: 1,
    p1Seen: 1,
    p1Rows: 1,
    p1Addressable: 1,
    p1BlockAmendment: 0,
    p1NoIdUriOther: 0,
    p1EmptyText: 0,
    provisions: [
      {
        kind: 'P1',
        labelPath: 'section/1',
        label: 's. 1',
        parentLabelPath: null,
        extent: 'E+W',
        text: 'Provision text.',
        docOrder: 0,
      },
    ],
  }

  it('rolls back and never commits when a provision write fails', async () => {
    const statements: string[] = []
    const client = {
      query: async (text: string) => {
        statements.push(text.split('\n')[0]!.trim())
        if (text.includes('insert into legislation_provisions')) {
          throw new Error('provision boom')
        }
        return { rows: [] }
      },
      release: vi.fn(),
    }
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => client,
    } as unknown as Db

    await expect(upsertLegislationDocument(pool, doc)).rejects.toThrow(
      'provision boom',
    )
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('persists the extraction-completeness note on the document row', async () => {
    // Declared 2 P1s, one addressable row and one textless addressable
    // P1: the stored note flags the unexplained row-less P1 so a
    // mismatch is auditable per Act instead of failing the document.
    const gappy: IngestDocument = {
      ...doc,
      declaredProvisions: 2,
      p1Seen: 2,
      p1Addressable: 2,
      p1Rows: 1,
      p1EmptyText: 1,
    }
    const seen: Array<{ text: string; values?: unknown[] }> = []
    const client = {
      query: async (text: string, values?: unknown[]) => {
        seen.push({ text, values })
        return { rows: [] }
      },
      release: vi.fn(),
    }
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => client,
    } as unknown as Db

    await upsertLegislationDocument(pool, gappy)
    const docInsert = seen.find((call) =>
      call.text.includes('insert into legislation_documents'),
    )
    expect(docInsert?.values?.[8]).toContain('addressable P1 emitted no row')
  })

  it('commits the document, delete, and inserts on one client', async () => {
    const statements: string[] = []
    const client = {
      query: async (text: string) => {
        statements.push(
          text.includes('insert into legislation_documents')
            ? 'INSERT doc'
            : text.includes('select label_path')
              ? 'SELECT old flags'
              : text.includes('delete from legislation_provisions')
                ? 'DELETE provs'
                : text.includes('insert into legislation_provisions')
                  ? 'INSERT prov'
                  : text,
        )
        return { rows: [] }
      },
      release: vi.fn(),
    }
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => client,
    } as unknown as Db

    await upsertLegislationDocument(pool, doc)
    expect(statements).toEqual([
      'BEGIN',
      'INSERT doc',
      'SELECT old flags',
      'DELETE provs',
      'INSERT prov',
      'COMMIT',
    ])
    expect(client.release).toHaveBeenCalled()
  })
})

describe('ingestYear with mocked fetch', () => {
  const clmlFor = (n: number) =>
    `<?xml version="1.0"?><Legislation RestrictExtent="E+W" NumberOfProvisions="1">` +
    `<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Act ${n}</dc:title></ukm:Metadata>` +
    `<P1 IdURI="http://www.legislation.gov.uk/id/ukpga/2020/${n}/section/1">` +
    `<Pnumber>1</Pnumber><P1para><Text>Provision text for act ${n}.</Text></P1para></P1>` +
    `</Legislation>`
  const feed = (nums: number[], next: string | null) =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    nums
      .map(
        (n) =>
          `<entry><id>http://www.legislation.gov.uk/id/ukpga/2020/${n}</id><title>Act ${n}</title></entry>`,
      )
      .join('') +
    (next
      ? `<link rel="next" type="application/atom+xml" href="${next}"/>`
      : '') +
    `</feed>`
  const page1 = feed(
    [10, 11, 12],
    'https://www.legislation.gov.uk/ukpga/2020/data.feed?page=2',
  )
  // Page 2 repeats c.12: the scope must dedupe it, not ingest it twice.
  const page2 = feed([12, 1, 2], null)

  const xmlResponse = (xml: string) =>
    ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => xml,
    }) as unknown as Response

  function createMockPool() {
    const docs = new Map<string, string>()
    const pool = {
      docs,
      async query(text: string, values?: unknown[]) {
        if (text.includes('select content_hash')) {
          const hash = docs.get(values?.[0] as string)
          return { rows: hash ? [{ content_hash: hash }] : [] }
        }
        return { rows: [] }
      },
      async connect() {
        return {
          query: async (text: string, values?: unknown[]) => {
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
              return { rows: [] }
            }
            if (text.includes('insert into legislation_documents')) {
              docs.set(values?.[0] as string, values?.[6] as string)
              return { rows: [] }
            }
            return { rows: [] }
          },
          release: () => {},
        }
      },
    } as unknown as Db & { docs: Map<string, string> }
    return pool
  }

  it('walks two pages, dedupes, and resumes by hash on re-run', async () => {
    const pool = createMockPool()
    const dataXmlFetches: string[] = []
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href === 'https://www.legislation.gov.uk/ukpga/2020/data.feed') {
        return xmlResponse(page1)
      }
      if (href.includes('page=2')) return xmlResponse(page2)
      const dataMatch = href.match(/\/ukpga\/2020\/(\d+)\/data\.xml$/)
      if (dataMatch) {
        dataXmlFetches.push(href)
        return xmlResponse(clmlFor(Number(dataMatch[1])))
      }
      throw new Error(`unexpected fetch ${href}`)
    }) as unknown as typeof fetch

    const deps = {
      pool,
      gapMs: 0,
      skipEffects: true,
      forceReparse: false,
      sleep: async () => {},
      fetchImpl,
    }
    const first = await ingestYear(deps, 2020)
    expect(first.actsListed).toBe(5)
    expect(first.stored).toBe(5)
    expect(first.provisionsStored).toBe(5)
    expect(first.skippedUnchanged).toBe(0)
    expect(first.failed).toBe(0)
    // Each mock body declares its one P1 and yields one row: no mismatch.
    expect(first.provisionCountMismatches).toEqual([])

    // Re-run re-fetches every body and compares hashes: nothing re-stores,
    // everything reports skipped-unchanged. The old row-presence skip would
    // have fetched zero bodies here.
    dataXmlFetches.length = 0
    const second = await ingestYear(deps, 2020)
    expect(second.actsListed).toBe(5)
    expect(second.stored).toBe(0)
    expect(second.skippedUnchanged).toBe(5)
    expect(second.failed).toBe(0)
    expect(dataXmlFetches).toHaveLength(5)
  })

  it('re-derives the count note when content is unchanged', async () => {
    // Act 7 is already stored with this exact body (hash match) but
    // carries a stale loud note from the old check. The re-ingest must
    // report skipped-unchanged for the provisions yet clear the note,
    // or a fixed check would never go quiet on healthy documents.
    const inner = createMockPool()
    const body = clmlFor(7)
    inner.docs.set('ukpga/2020/7', sha256Hex(body))
    const updates: Array<{ text: string; values?: unknown[] }> = []
    const pool = {
      docs: inner.docs,
      query: async (text: string, values?: unknown[]) => {
        updates.push({ text, values })
        return inner.query(text, values)
      },
      connect: () => inner.connect(),
    } as unknown as Db & { docs: Map<string, string> }
    const fetchImpl = (async (url: unknown) => {
      if (String(url).endsWith('/ukpga/2020/7/data.xml')) {
        return xmlResponse(body)
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    }) as unknown as typeof fetch
    const deps = {
      pool,
      gapMs: 0,
      skipEffects: true,
      forceReparse: false,
      sleep: async () => {},
      fetchImpl,
    }
    const outcome = await ingestOneAct(deps, {
      actType: 'ukpga',
      year: 2020,
      number: 7,
      title: 'Act 7',
    })
    expect(outcome.status).toBe('skipped-unchanged')
    // The mock body declares its one P1 and yields one row: healthy, so
    // the refresh writes back the quiet (empty) note.
    const refresh = updates.find((call) =>
      call.text.includes('update legislation_documents'),
    )
    expect(refresh?.values).toEqual(['ukpga/2020/7', ''])
  })
})

/**
 * Security fix: the effects pass is staged BEFORE any row write. The
 * replacement deletes and recreates every provision row, so a failed or
 * unreadable feed must never leave servable flags behind (a row must not
 * land servable before its effects state is known), and --force-reparse
 * must re-store AND re-run the pass.
 */
describe('ingestOneAct effects staging and --force-reparse', () => {
  const identity = 'ukpga/2020/1'
  const clmlBody = (sections: number[]) =>
    `<?xml version="1.0"?><Legislation RestrictExtent="E+W" NumberOfProvisions="${sections.length}">` +
    `<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Act 1</dc:title></ukm:Metadata>` +
    sections
      .map(
        (n) =>
          `<P1 IdURI="http://www.legislation.gov.uk/id/${identity}/section/${n}">` +
          `<Pnumber>${n}</Pnumber><P1para><Text>Provision text for s. ${n}.</Text></P1para></P1>`,
      )
      .join('') +
    `</Legislation>`

  /** One feed page with one unapplied effect per path. */
  const effectsFeed = (unapplied: string[]) =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">` +
    unapplied
      .map(
        (path, index) =>
          `<entry><id>http://www.legislation.gov.uk/changes/affected/${identity}/effect-${index}</id>` +
          `<content type="text/xml"><ukm:Effect Applied="false" Type="words inserted" EffectId="effect-${index}" AffectedProvisions="${path}" AffectingYear="2021" AffectedYear="2020" AffectedNumber="1" AffectingNumber="2" AffectedURI="http://www.legislation.gov.uk/id/${identity}" AffectingURI="http://www.legislation.gov.uk/id/ukpga/2021/2">` +
          `<ukm:AffectedTitle>Act 1</ukm:AffectedTitle><ukm:AffectedProvisions><ukm:Section Ref="${path.replaceAll('/', '-')}" URI="http://www.legislation.gov.uk/id/${identity}/${path}">${path}</ukm:Section></ukm:AffectedProvisions>` +
          `<ukm:AffectingTitle>Later Act 2021</ukm:AffectingTitle></ukm:Effect></content></entry>`,
      )
      .join('') +
    `</feed>`

  const httpResponse = (status: number, body: string) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () => body,
    }) as unknown as Response

  interface StoredRow {
    labelPath: string
    hasUnappliedEffects: boolean
    effectsCheckedAt: string | null
  }

  function createPool(initial: StoredRow[], storedHash: string | null) {
    const rows = new Map<string, StoredRow[]>()
    if (initial.length > 0) rows.set(identity, initial)
    const events: string[] = []
    const insertedRows: StoredRow[] = []
    const pool = {
      rows,
      events,
      insertedRows,
      async query(text: string, _values?: unknown[]) {
        if (text.includes('select content_hash')) {
          return {
            rows: storedHash ? [{ content_hash: storedHash }] : [],
          }
        }
        return { rows: [] }
      },
      async connect() {
        return {
          query: async (text: string, values?: unknown[]) => {
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
              return { rows: [] }
            }
            if (text.includes('insert into legislation_documents')) {
              return { rows: [] }
            }
            if (text.includes('select label_path')) {
              return {
                rows: (rows.get(values?.[0] as string) ?? []).map((row) => ({
                  label_path: row.labelPath,
                  has_unapplied_effects: row.hasUnappliedEffects,
                  effects_checked_at: row.effectsCheckedAt,
                })),
              }
            }
            if (text.includes('delete from legislation_provisions')) {
              events.push('delete')
              return { rows: [] }
            }
            if (text.includes('insert into legislation_provisions')) {
              events.push('insert')
              insertedRows.push({
                labelPath: values?.[2] as string,
                hasUnappliedEffects: values?.[10] as boolean,
                effectsCheckedAt: values?.[11] as string | null,
              })
              return { rows: [] }
            }
            return { rows: [] }
          },
          release: vi.fn(),
        }
      },
    } as unknown as Db & {
      rows: Map<string, StoredRow[]>
      events: string[]
      insertedRows: StoredRow[]
    }
    return pool
  }

  const depsFor = (
    pool: ReturnType<typeof createPool>,
    fetchImpl: typeof fetch,
    forceReparse: boolean,
  ): LegislationIngestDeps => ({
    pool,
    gapMs: 0,
    skipEffects: false,
    forceReparse,
    sleep: async () => {},
    fetchImpl,
  })

  const actRef = {
    actType: 'ukpga',
    year: 2020,
    number: 1,
    title: 'Act 1',
  }

  it('--force-reparse re-stores an unchanged Act and re-runs the pass', async () => {
    // Stored hash matches the current body, so the normal path would skip;
    // the forced path re-stores and recomputes flags from the feed (the
    // old true on section/1 clears, the new section/2 reads as amended).
    const body = clmlBody([1, 2])
    const pool = createPool(
      [
        {
          labelPath: 'section/1',
          hasUnappliedEffects: true,
          effectsCheckedAt: '2020-01-01T00:00:00Z',
        },
      ],
      sha256Hex(body),
    )
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href.endsWith(`/${identity}/data.xml`)) return httpResponse(200, body)
      if (href.includes('/changes/affected/'))
        return httpResponse(200, effectsFeed(['section/2']))
      throw new Error(`unexpected fetch ${href}`)
    }) as unknown as typeof fetch
    const outcome = await ingestOneAct(depsFor(pool, fetchImpl, true), actRef)
    expect(outcome.status).toBe('stored')
    expect(pool.events).toEqual(['delete', 'insert', 'insert'])
    expect(pool.insertedRows).toEqual([
      {
        labelPath: 'section/1',
        hasUnappliedEffects: false,
        effectsCheckedAt: expect.any(Date),
      },
      {
        labelPath: 'section/2',
        hasUnappliedEffects: true,
        effectsCheckedAt: expect.any(Date),
      },
    ])
  })

  it('a failed effects feed aborts before any row write', async () => {
    const body = clmlBody([1, 2])
    const pool = createPool(
      [
        {
          labelPath: 'section/1',
          hasUnappliedEffects: true,
          effectsCheckedAt: null,
        },
      ],
      sha256Hex(body),
    )
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href.endsWith(`/${identity}/data.xml`)) return httpResponse(200, body)
      throw new Error('effects feed down')
    }) as unknown as typeof fetch
    const outcome = await ingestOneAct(depsFor(pool, fetchImpl, true), actRef)
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.reason).toContain('effects pass failed')
    // The known-good rows and their withheld flag are untouched.
    expect(pool.events).toEqual([])
    expect(pool.insertedRows).toEqual([])
  })

  it('an unreadable (404) feed preserves old flags and withholds new rows', async () => {
    const body = clmlBody([1, 2])
    const pool = createPool(
      [
        {
          labelPath: 'section/1',
          hasUnappliedEffects: true,
          effectsCheckedAt: '2020-01-01T00:00:00Z',
        },
      ],
      sha256Hex(body),
    )
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href.endsWith(`/${identity}/data.xml`)) return httpResponse(200, body)
      if (href.includes('/changes/affected/'))
        return httpResponse(404, 'not found')
      throw new Error(`unexpected fetch ${href}`)
    }) as unknown as typeof fetch
    const outcome = await ingestOneAct(depsFor(pool, fetchImpl, true), actRef)
    expect(outcome.status).toBe('stored')
    // 404 is "no information", not "no effects": section/1 keeps its true
    // flag and the new section/2 defaults to withheld rather than servable.
    expect(pool.insertedRows).toEqual([
      {
        labelPath: 'section/1',
        hasUnappliedEffects: true,
        effectsCheckedAt: '2020-01-01T00:00:00Z',
      },
      {
        labelPath: 'section/2',
        hasUnappliedEffects: true,
        effectsCheckedAt: null,
      },
    ])
  })

  it('--skip-effects never lands unchecked new rows servable', async () => {
    // Brand-new Act with no stored rows and no effects pass: every row is
    // withheld, never servable-by-default from the column default.
    const body = clmlBody([1, 2])
    const pool = createPool([], null)
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href.endsWith(`/${identity}/data.xml`)) return httpResponse(200, body)
      throw new Error(`unexpected fetch ${href}`)
    }) as unknown as typeof fetch
    const deps = depsFor(pool, fetchImpl, false)
    deps.skipEffects = true
    const outcome = await ingestOneAct(deps, actRef)
    expect(outcome.status).toBe('stored')
    expect(pool.insertedRows.map((row) => row.hasUnappliedEffects)).toEqual([
      true,
      true,
    ])
  })

  it('an unchanged Act stays skipped-unchanged without --force-reparse', async () => {
    const body = clmlBody([1])
    const pool = createPool(
      [
        {
          labelPath: 'section/1',
          hasUnappliedEffects: false,
          effectsCheckedAt: '2020-01-01T00:00:00Z',
        },
      ],
      sha256Hex(body),
    )
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href.endsWith(`/${identity}/data.xml`)) return httpResponse(200, body)
      throw new Error(`unexpected fetch ${href}`)
    }) as unknown as typeof fetch
    const outcome = await ingestOneAct(depsFor(pool, fetchImpl, false), actRef)
    expect(outcome.status).toBe('skipped-unchanged')
    expect(pool.events).toEqual([])
  })

  it('a legacy unchecked false row never survives a reparse as servable', async () => {
    // Migration-default rows (or pre-effects inserts) carry
    // has_unapplied_effects=false with effects_checked_at=null: never
    // checked, so not known-good. When the effects pass cannot run, the
    // rewrite must not preserve that false — the row withholds (flag
    // true, timestamp still null) until a real check replaces it.
    const body = clmlBody([1])
    const pool = createPool(
      [
        {
          labelPath: 'section/1',
          hasUnappliedEffects: false,
          effectsCheckedAt: null,
        },
      ],
      sha256Hex(body),
    )
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href.endsWith(`/${identity}/data.xml`)) return httpResponse(200, body)
      if (href.includes('/changes/affected/'))
        return httpResponse(404, 'not found')
      throw new Error(`unexpected fetch ${href}`)
    }) as unknown as typeof fetch
    const outcome = await ingestOneAct(depsFor(pool, fetchImpl, true), actRef)
    expect(outcome.status).toBe('stored')
    expect(pool.insertedRows).toEqual([
      {
        labelPath: 'section/1',
        hasUnappliedEffects: true,
        effectsCheckedAt: null,
      },
    ])
  })
})

/**
 * Fail-closed paging (second security review): only a FIRST-page 404 may
 * mean "no feed". A later-page 404, a non-OK page, a cycling rel=next
 * walk, or a feed longer than the 100-page cap must abort by throwing —
 * never return a partial effect set, which would clear the withheld flags
 * of provisions whose effects live on unread pages.
 */
describe('readUnappliedEffects fail-closed paging', () => {
  const identity = 'ukpga/2020/1'
  const base =
    'https://www.legislation.gov.uk/changes/affected/ukpga/2020/1/data.feed'

  const httpResponse = (status: number, body: string) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () => body,
    }) as unknown as Response

  const feedPage = (next: string | null) =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    (next
      ? `<link rel="next" type="application/atom+xml" href="${next}"/>`
      : '') +
    `</feed>`

  const feedWithEffect = (next: string | null, path: string) =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">` +
    `<entry><id>http://www.legislation.gov.uk/changes/affected/ukpga/2020/1/e1</id>` +
    `<content type="text/xml"><ukm:Effect Applied="false" Type="words inserted" EffectId="e1" AffectedProvisions="${path}" AffectingYear="2021" AffectedYear="2020" AffectedNumber="1" AffectingNumber="2" AffectedURI="http://www.legislation.gov.uk/id/ukpga/2020/1" AffectingURI="http://www.legislation.gov.uk/id/ukpga/2021/2">` +
    `<ukm:AffectedTitle>Act 1</ukm:AffectedTitle><ukm:AffectedProvisions><ukm:Section Ref="section-2" URI="http://www.legislation.gov.uk/id/ukpga/2020/1/${path}">${path}</ukm:Section></ukm:AffectedProvisions>` +
    `<ukm:AffectingTitle>Later Act 2021</ukm:AffectingTitle></ukm:Effect></content></entry>` +
    (next
      ? `<link rel="next" type="application/atom+xml" href="${next}"/>`
      : '') +
    `</feed>`

  const depsFor = (fetchImpl: typeof fetch): LegislationIngestDeps => ({
    pool: {} as Db,
    gapMs: 0,
    skipEffects: false,
    forceReparse: false,
    sleep: async () => {},
    fetchImpl,
  })

  const doc: IngestDocument = {
    identity,
    actType: 'ukpga',
    year: 2020,
    number: 1,
    title: 'Act 1',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2020/1',
    contentHash: 'hash',
    extent: 'E+W',
    declaredProvisions: 0,
    p1Seen: 0,
    p1Rows: 0,
    p1Addressable: 0,
    p1BlockAmendment: 0,
    p1NoIdUriOther: 0,
    p1EmptyText: 0,
    provisions: [],
  }

  it('a first-page 404 means no feed: null, not a servable-clearing set', async () => {
    const fetchImpl = (async () =>
      httpResponse(404, 'not found')) as unknown as typeof fetch
    const result = await readUnappliedEffects(depsFor(fetchImpl), doc)
    expect(result).toBeNull()
  })

  it('a later-page 404 after earlier pages read aborts instead of returning a partial set', async () => {
    // Review repro: page 1 carries rel=next and no effects, page 2 404s.
    // Old code broke out and returned the page-1 set non-null, rewriting
    // every flag servable. Now the mid-walk 404 throws and nothing writes.
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href === base) return httpResponse(200, feedPage(`${base}?page=2`))
      return httpResponse(404, 'not found')
    }) as unknown as typeof fetch
    await expect(readUnappliedEffects(depsFor(fetchImpl), doc)).rejects.toThrow(
      /404/,
    )
  })

  it('aborts at the 100-page cap instead of silently truncating', async () => {
    // Review repro: 100 chained pages each promising another returned a
    // non-null (partial) set under the old cap-break. Now the cap aborts.
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      const page = Number(/page=(\d+)$/.exec(href)?.[1] ?? '1')
      return httpResponse(200, feedPage(`${base}?page=${page + 1}`))
    }) as unknown as typeof fetch
    await expect(readUnappliedEffects(depsFor(fetchImpl), doc)).rejects.toThrow(
      /exceeded 100 pages/,
    )
  })

  it('aborts on a cycling feed instead of looping to the cap', async () => {
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href === base) return httpResponse(200, feedPage(`${base}?page=2`))
      // Page 2 points back at itself: an instant cycle.
      return httpResponse(200, feedPage(`${base}?page=2`))
    }) as unknown as typeof fetch
    await expect(readUnappliedEffects(depsFor(fetchImpl), doc)).rejects.toThrow(
      /cycled back/,
    )
  })

  it('a completed walk returns every collected label path', async () => {
    const fetchImpl = (async (url: unknown) => {
      const href = String(url)
      if (href === base)
        return httpResponse(200, feedWithEffect(`${base}?page=2`, 'section/2'))
      return httpResponse(200, feedWithEffect(null, 'section/3'))
    }) as unknown as typeof fetch
    const result = await readUnappliedEffects(depsFor(fetchImpl), doc)
    expect(result).toEqual(new Set(['section/2', 'section/3']))
  })
})
