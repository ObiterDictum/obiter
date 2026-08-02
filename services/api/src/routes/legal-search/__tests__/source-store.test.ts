import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryLegalAuthoritySourceStore,
  createPostgresLegalAuthoritySourceStore,
} from '../source-store'

const sourceProvider = {
  documentUri: '/uksc/2024/3',
  sourceUri: '/uksc/2024/3',
  xmlUri: null,
  pdfUri: null,
  contentHash: 'abc123',
  rawAtomEntry: '<entry />',
}

const storedAuthority = {
  id: 'uksc-2024-3',
  title: 'Potanina v Potanin',
  neutralCitation: '[2024] UKSC 3',
  court: 'uksc',
  jurisdiction: 'uk',
  dateDecided: '2024-01-31',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
  paragraphs: [
    {
      id: 'uksc-2024-3-p1',
      documentId: 'uksc-2024-3',
      paragraphNumber: 1,
      text: 'The judgment discusses a fiduciary appendix that is absent from summary metadata.',
    },
  ],
}

describe('legal authority source store search', () => {
  it('matches hydrated paragraph text in the in-memory source fallback', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()

    await store.upsertDocument(storedAuthority, sourceProvider)

    const results = await store.search('fiduciary appendix', { court: 'uksc' })

    expect(results).toMatchObject([{ id: 'uksc-2024-3' }])
  })

  it('supports filter-only browsing in the in-memory source fallback', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()

    await store.upsertDocument(storedAuthority, sourceProvider)

    const results = await store.search('', { court: 'uksc' })

    expect(results).toMatchObject([{ id: 'uksc-2024-3' }])
  })

  it('does not treat substrings as complete query terms in memory', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()
    const exactDocument = {
      ...storedAuthority,
      id: 'benchmark-docket-101',
      title: 'Alpha v Beta',
      sourceUrl: 'https://example.test/judgments/benchmark-docket-101',
      paragraphs: [
        {
          id: 'benchmark-docket-101-p1',
          documentId: 'benchmark-docket-101',
          paragraphNumber: 1,
          text: 'The court applied the test as a complete word.',
        },
      ],
    }
    const substringDocument = {
      ...storedAuthority,
      id: 'benchmark-docket-102',
      title: 'Gamma v Delta',
      sourceUrl: 'https://example.test/judgments/benchmark-docket-102',
      paragraphs: [
        {
          id: 'benchmark-docket-102-p1',
          documentId: 'benchmark-docket-102',
          paragraphNumber: 1,
          text: 'Contested testimony concerned a testator and an intestate estate.',
        },
      ],
    }

    await store.upsertDocument(exactDocument, sourceProvider)
    await store.upsertDocument(substringDocument, sourceProvider)

    const results = await store.search('test', {})

    expect(results.map(({ id }) => id)).toEqual(['benchmark-docket-101'])
  })

  it('keeps Postgres fallback on an indexed paragraph-inclusive search vector', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values })
        if (text.includes('from legal_source_documents')) {
          return {
            rows: [
              {
                summary_json: {
                  ...storedAuthority,
                  paragraphs: undefined,
                },
                document_json: storedAuthority,
                provider_json: sourceProvider,
              },
            ],
          }
        }

        return { rows: [] }
      }),
      release: vi.fn(),
    }
    const pool = {
      connect: vi.fn(async () => client),
    }
    const store = createPostgresLegalAuthoritySourceStore(pool as never)

    const results = await store.search('fiduciary appendix', { court: 'uksc' })

    expect(results).toMatchObject([{ id: 'uksc-2024-3' }])
    expect(client.query).toHaveBeenCalledWith(
      'select set_config($1, $2, true)',
      ['statement_timeout', '350ms'],
    )
    const searchSql = queries.find((query) =>
      query.text.includes('from legal_source_documents'),
    )?.text
    expect(searchSql).toContain('search_vector @@ websearch_to_tsquery')
    expect(searchSql).toContain('normalize(coalesce(')
    expect(searchSql).toContain('translate(normalize(')
    expect(searchSql).not.toContain('document_json::text')
    expect(searchSql).not.toContain("summary_json::text || ' '")

    const migration = readFileSync(
      new URL(
        '../../../../../../packages/database/migrations/0004_legal_source_documents_body_search.sql',
        import.meta.url,
      ),
      'utf8',
    )
    expect(migration).toContain(
      "jsonb_path_query_array(document_json, '$.paragraphs[*].text')",
    )
    expect(migration).toContain('using gin (search_vector)')
  })

  it('uses the client exact-match normalizer for Postgres query values', async () => {
    const client = {
      query: vi.fn(async (text: string, _values?: unknown[]) => {
        if (text.includes('from normalized_documents')) return { rows: [] }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    const pool = { connect: vi.fn(async () => client) }
    const store = createPostgresLegalAuthoritySourceStore(pool as never)

    await store.search('[2024]\u00a0UKSC 3', {})

    const searchCall = client.query.mock.calls.find(([text]) =>
      text.includes('from normalized_documents'),
    )
    expect(searchCall?.[1]).toMatchObject([
      null,
      null,
      null,
      null,
      null,
      '[2024] uksc 3',
      '[2024] uksc 3',
    ])
  })
})
