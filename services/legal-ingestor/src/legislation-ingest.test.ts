import { describe, expect, it, vi } from 'vitest'
import {
  ingestOneAct,
  ingestYear,
  nextFeedPageUrl,
  parseLegislationIngestArgs,
  resolveRequestGapMs,
  upsertLegislationDocument,
  type Db,
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
        labelPath: 'section/1',
        label: 's. 1',
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
