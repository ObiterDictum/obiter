import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { VerificationSubject } from '@obiter/verification-core'
import { checkAuthorityExistence } from './authority-existence'
import { resolveCitationCandidates } from './citation-resolution'
import {
  citationOf,
  createResolutionPipeline,
} from './citation-resolution.test-support'

/**
 * Case-law citation resolution against the real Postgres public legal-source
 * record, wired to the authority-existence check the way a caller will wire it.
 * Requires TEST_DATABASE_URL.
 */

const subject: VerificationSubject = { documentId: 'd-v3-db', versionId: 'v-1' }

interface Fixture {
  id: string
  neutralCitation: string
  withdrawn?: boolean
  paragraphs?: boolean
}

const judgmentFixtures: Fixture[] = [
  { id: 'db-test-v3-uksc-1', neutralCitation: '[2066] UKSC 1' },
  { id: 'db-test-v3-ewca-7', neutralCitation: '[2066] EWCA Civ 7' },
  { id: 'db-test-v3-pad', neutralCitation: '[2066] UKUT 00236 (IAC)' },
  {
    id: 'db-test-v3-withdrawn',
    neutralCitation: '[2066] UKSC 3',
    withdrawn: true,
  },
  {
    id: 'db-test-v3-summary-only',
    neutralCitation: '[2066] UKSC 4',
    paragraphs: false,
  },
  { id: 'db-test-v3-live-dup', neutralCitation: '[2066] UKSC 6' },
  {
    id: 'db-test-v3-withdrawn-dup',
    neutralCitation: '[2066] UKSC 6',
    withdrawn: true,
  },
  { id: 'db-test-v3-dup-a', neutralCitation: '[2066] UKSC 77' },
  { id: 'db-test-v3-dup-b', neutralCitation: '[2066] UKSC 77' },
]

describe('case law resolution against the stored record', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for citation-resolution.db.test.ts',
    )
  }
  const pool = new Pool({ connectionString })
  const { resolveOne, resolveThenCheck } = createResolutionPipeline(
    pool,
    subject,
  )

  beforeAll(async () => {
    for (const fixture of judgmentFixtures) {
      await insertAuthority(pool, fixture)
    }
  })

  afterAll(async () => {
    await pool.query(
      `delete from legal_source_documents where document_id like 'db-test-v3-%'`,
    )
    await pool.end()
  })

  it('resolves a held citation and checks the identity it produced', async () => {
    const { resolution, finding } = await resolveThenCheck('[2066] UKSC 1')

    expect(resolution).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'case_law',
        neutralCitation: '[2066] UKSC 1',
        sourceId: 'db-test-v3-uksc-1',
      },
    })
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        granularity: 'document',
        sourceId: 'db-test-v3-uksc-1',
      },
    ])
  })

  it('resolves the case and whitespace variants the shared fold accepts', async () => {
    for (const rawText of ['[2066]  uksc   1', '[2066] UKSC 1']) {
      expect(await resolveOne(rawText)).toMatchObject({
        outcome: 'resolved',
        citation: { sourceId: 'db-test-v3-uksc-1' },
      })
    }
  })

  it('resolves a zero-padded tribunal citation to the unpadded stored row', async () => {
    expect(await resolveOne('[2066] UKUT 236 (IAC)')).toMatchObject({
      outcome: 'resolved',
      citation: { sourceId: 'db-test-v3-pad' },
    })
  })

  it('resolves a summary-only judgment, whose identity is the document', async () => {
    const { resolution, finding } = await resolveThenCheck('[2066] UKSC 4')

    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: { sourceId: 'db-test-v3-summary-only' },
    })
    expect(finding.status).toEqual({ state: 'clear' })
  })

  it('leaves an unheld citation unresolved and never reaches the store as one', async () => {
    const { resolution, finding } = await resolveThenCheck('[2066] UKSC 999')

    expect(resolution).toEqual({ outcome: 'unresolved' })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
    // Not a non-existence claim, and not the authority-existence check's
    // verdict either: resolution could not establish an identity to check.
    expect(finding.status).not.toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.explanation.toLowerCase()).not.toContain('does not exist')
  })

  it('reports duplicate live carriers as ambiguous, never first-match-wins', async () => {
    expect(await resolveOne('[2066] UKSC 77')).toEqual({ outcome: 'ambiguous' })
  })

  it('refuses to choose between a live and a withdrawn carrier', async () => {
    // Resolution does not read the withdrawn flag: choosing between duplicate
    // carriers means judging which record is trustworthy, which is the
    // authority-existence check's decision. Given the live identity directly,
    // V2 still clears on it, so its semantics are unchanged.
    expect(await resolveOne('[2066] UKSC 6')).toEqual({ outcome: 'ambiguous' })

    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citationOf('[2066] UKSC 6'),
      normalizedCitation: {
        kind: 'case_law',
        neutralCitation: '[2066] UKSC 6',
        sourceId: 'db-test-v3-live-dup',
      },
    })
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence[0]?.sourceId).toBe('db-test-v3-live-dup')
  })

  it('resolves a single withdrawn carrier and lets V2 judge its trustworthiness', async () => {
    const { resolution, finding } = await resolveThenCheck('[2066] UKSC 3')

    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: { sourceId: 'db-test-v3-withdrawn' },
    })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('resolves a whole document in one candidate lookup', async () => {
    let caseLawQueries = 0
    const counting = {
      query: (text: string, values?: unknown[]) => {
        if (text.includes('legal_source_documents')) caseLawQueries += 1
        return pool.query(text, values as never)
      },
    } as unknown as Pick<Pool, 'query'>

    const results = await resolveCitationCandidates(
      counting,
      [
        '[2066] UKSC 1',
        '[2066] EWCA Civ 7',
        '[2066] UKSC 3',
        '[2066] UKUT 236 (IAC)',
        '[2066] UKSC 1',
      ].map((rawText, index) => ({ id: `c-${index}`, rawText })),
    )

    expect(caseLawQueries).toBe(1)
    expect(
      results.every((result) => result.resolution.outcome === 'resolved'),
    ).toBe(true)
  })

  it('returns results in input order with the identifiers it was given', async () => {
    const batch = [
      { id: 'p-1:0-13', rawText: '[2066] UKSC 1' },
      { id: 'p-2:0-14', rawText: '[2066] UKSC 999' },
      { id: 'p-3:0-12', rawText: '[2066 UKSC' },
    ]

    const results = await resolveCitationCandidates(pool, batch)

    expect(results.map((result) => result.id)).toEqual(
      batch.map((candidate) => candidate.id),
    )
    expect(results.map((result) => result.resolution.outcome)).toEqual([
      'resolved',
      'unresolved',
      'malformed',
    ])
  })

  it('is safe for an empty batch', async () => {
    expect(await resolveCitationCandidates(pool, [])).toEqual([])
  })
})

async function insertAuthority(pool: Pool, fixture: Fixture) {
  const summary = {
    id: fixture.id,
    title: `Stored ${fixture.neutralCitation}`,
    neutralCitation: fixture.neutralCitation,
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2066-01-15',
    sourceType: 'judgment',
    sourceUrl: `https://caselaw.nationalarchives.gov.uk/${fixture.id}`,
  }
  const paragraphs = [
    {
      id: `${fixture.id}-p1`,
      documentId: fixture.id,
      paragraphNumber: 1,
      text: 'The stored judgment text.',
    },
  ]
  const provider = {
    documentUri: `/${fixture.id}`,
    sourceUri: `/${fixture.id}`,
    xmlUri: null,
    pdfUri: null,
    contentHash: `dbtest-v3-${fixture.id}`,
    ...(fixture.withdrawn
      ? {
          withdrawn: {
            at: '2066-09-01T00:00:00.000Z',
            checkedUris: [`/${fixture.id}`],
            runIds: ['run-0'],
          },
        }
      : {}),
  }
  const documentJson =
    fixture.paragraphs === false ? null : { ...summary, paragraphs }
  await pool.query(
    `insert into legal_source_documents
       (document_id, summary_json, document_json, provider_json,
        content_hash, source_uri)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)`,
    [
      fixture.id,
      JSON.stringify(summary),
      documentJson ? JSON.stringify(documentJson) : null,
      JSON.stringify(provider),
      provider.contentHash,
      provider.sourceUri,
    ],
  )
}
