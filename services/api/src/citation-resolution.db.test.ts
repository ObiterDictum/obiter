import { Pool } from 'pg'
import { createTestPool } from './test-database.test-support'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type {
  CitationResolution,
  VerificationFinding,
  VerificationSubject,
} from '@obiter/verification-core'
import { checkAuthorityExistence } from './authority-existence'
import { resolveCitationCandidates } from './citation-resolution'
import {
  citationOf,
  createResolutionPipeline,
} from './citation-resolution.test-support'


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
  { id: 'db-test-v3-live8', neutralCitation: '[2066] UKSC 8' },
  { id: 'db-test-v3-wd8a', neutralCitation: '[2066] UKSC 8', withdrawn: true },
  { id: 'db-test-v3-wd8b', neutralCitation: '[2066] UKSC 8', withdrawn: true },
  { id: 'db-test-v3-wd9a', neutralCitation: '[2066] UKSC 9', withdrawn: true },
  { id: 'db-test-v3-wd9b', neutralCitation: '[2066] UKSC 9', withdrawn: true },
]

describe('case law resolution against the stored record', () => {
  const pool = createTestPool()
  const { resolveOne, resolveThenCheck } = createResolutionPipeline(
    pool,
    subject,
  )

  beforeAll(async () => {
    for (const fixture of judgmentFixtures) {
      await insertAuthority(pool, fixture)
    }
    await pool.query(
      `insert into legal_source_documents
         (document_id, summary_json, provider_json, content_hash, source_uri)
       values ($1, $2::jsonb, '{}'::jsonb, $3, $4)`,
      [
        'db-test-v3-malformed',
        JSON.stringify({
          id: 'db-test-v3-malformed',
          neutralCitation: '[2066] UKSC 10',
        }),
        'dbtest-v3-malformed',
        '/db-test-v3-malformed',
      ],
    )
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
    expect(finding.status).not.toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.explanation.toLowerCase()).not.toContain('does not exist')
  })

  it('resolves the live carrier beside a withdrawn one and clears on it', async () => {
    expect(await resolveOne('[2066] UKSC 6')).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'case_law',
        neutralCitation: '[2066] UKSC 6',
        sourceId: 'db-test-v3-live-dup',
      },
    })

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

  const carrierStates: Array<{
    state: string
    citation: string
    v3: CitationResolution
    v2Status: VerificationFinding['status']
  }> = [
    {
      state: 'no carrier',
      citation: '[2066] UKSC 100',
      v3: { outcome: 'unresolved' },
      v2Status: { state: 'review_required', reason: 'citation_unresolved' },
    },
    {
      state: 'one live carrier',
      citation: '[2066] UKSC 1',
      v3: {
        outcome: 'resolved',
        citation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 1',
          sourceId: 'db-test-v3-uksc-1',
        },
      },
      v2Status: { state: 'clear' },
    },
    {
      state: 'one withdrawn carrier',
      citation: '[2066] UKSC 3',
      v3: {
        outcome: 'resolved',
        citation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 3',
          sourceId: 'db-test-v3-withdrawn',
        },
      },
      v2Status: {
        state: 'review_required',
        reason: 'evidence_unavailable',
      },
    },
    {
      state: 'one live plus one withdrawn',
      citation: '[2066] UKSC 6',
      v3: {
        outcome: 'resolved',
        citation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 6',
          sourceId: 'db-test-v3-live-dup',
        },
      },
      v2Status: { state: 'clear' },
    },
    {
      state: 'one live plus multiple withdrawn',
      citation: '[2066] UKSC 8',
      v3: {
        outcome: 'resolved',
        citation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 8',
          sourceId: 'db-test-v3-live8',
        },
      },
      v2Status: { state: 'clear' },
    },
    {
      state: 'multiple live',
      citation: '[2066] UKSC 77',
      v3: { outcome: 'ambiguous' },
      v2Status: { state: 'review_required', reason: 'citation_ambiguous' },
    },
    {
      state: 'multiple withdrawn',
      citation: '[2066] UKSC 9',
      v3: { outcome: 'ambiguous' },
      v2Status: { state: 'review_required', reason: 'citation_ambiguous' },
    },
    {
      state: 'malformed carrier row',
      citation: '[2066] UKSC 10',
      v3: {
        outcome: 'resolved',
        citation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 10',
          sourceId: 'db-test-v3-malformed',
        },
      },
      v2Status: { state: 'review_required', reason: 'check_inconclusive' },
    },
  ]

  it.each(carrierStates)(
    'agrees on $state',
    async ({ citation, v3, v2Status }) => {
      const { resolution, finding } = await resolveThenCheck(citation)

      expect(resolution).toEqual(v3)
      expect(finding.status).toEqual(v2Status)
    },
  )

  it('documents the multiple-withdrawn limitation instead of picking one', async () => {
    expect(await resolveOne('[2066] UKSC 9')).toEqual({ outcome: 'ambiguous' })

    for (const sourceId of ['db-test-v3-wd9a', 'db-test-v3-wd9b']) {
      const finding = await checkAuthorityExistence(pool, {
        subject,
        citation: citationOf('[2066] UKSC 9'),
        normalizedCitation: {
          kind: 'case_law',
          neutralCitation: '[2066] UKSC 9',
          sourceId,
        },
      })
      expect(finding.status).toEqual({
        state: 'review_required',
        reason: 'evidence_unavailable',
      })
    }
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
