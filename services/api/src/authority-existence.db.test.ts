import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkAuthorityExistence,
  lookupAuthorityExistence,
} from './authority-existence'
import type {
  CitationInput,
  NormalizedCitation,
  VerificationSubject,
} from '@obiter/verification-core'

/**
 * Authority existence against the real Postgres public legal-source record.
 * The lookup is exact source identity, not a keyword search, and a store
 * failure or a withdrawn source must never read as not held. Requires
 * TEST_DATABASE_URL.
 */

const subject: VerificationSubject = { documentId: 'd-v2-db', versionId: 'v-1' }

function citation(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-1', start: 0, end: rawText.length },
  }
}

function caseLaw(
  neutralCitation: string,
  sourceId: string,
): NormalizedCitation {
  return { kind: 'case_law', neutralCitation, sourceId }
}

function legislation(
  documentIdentity: string,
  labelPath: string | null,
): NormalizedCitation {
  return { kind: 'legislation', documentIdentity, labelPath }
}

interface AuthorityFixture {
  id: string
  neutralCitation: string
  withdrawn?: boolean
  paragraphs?: boolean
}

const judgmentFixtures: AuthorityFixture[] = [
  { id: 'db-test-v2-uksc-1', neutralCitation: '[2099] UKSC 1' },
  { id: 'db-test-v2-uksc-2', neutralCitation: '[2099] UKSC 2' },
  { id: 'db-test-v2-dup-a', neutralCitation: '[2099] UKSC 777' },
  { id: 'db-test-v2-dup-b', neutralCitation: '[2099] UKSC 777' },
  {
    id: 'db-test-v2-withdrawn',
    neutralCitation: '[2099] UKSC 3',
    withdrawn: true,
  },
  { id: 'db-test-v2-pad', neutralCitation: '[2099] UKUT 00236 (IAC)' },
  {
    id: 'db-test-v2-summary-only',
    neutralCitation: '[2099] UKSC 4',
    paragraphs: false,
  },
]

const legislationFixture = {
  identity: 'ukpga/2099/1',
  title: 'Test Authority Act 2099',
  provisions: [
    { id: 'ukpga/2099/1/section/1', labelPath: 'section/1', label: 's. 1' },
    { id: 'ukpga/2099/1/section/40', labelPath: 'section/40', label: 's. 40' },
  ],
}

const emptyActIdentity = 'ukpga/2099/2'

describe('authority existence against the stored legal source record', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for authority-existence.db.test.ts',
    )
  }
  const pool = new Pool({ connectionString })

  beforeAll(async () => {
    for (const fixture of judgmentFixtures) {
      await insertAuthority(pool, fixture)
    }
    await pool.query(
      `insert into legislation_documents
         (identity, act_type, year, number, title, source_url, content_hash)
       values ($1, 'ukpga', 2099, 1, $2, $3, 'dbtest-v2-act')`,
      [
        legislationFixture.identity,
        legislationFixture.title,
        `https://www.legislation.gov.uk/${legislationFixture.identity}`,
      ],
    )
    for (const [index, provision] of legislationFixture.provisions.entries()) {
      await pool.query(
        `insert into legislation_provisions
           (id, document_identity, label_path, label, provision_text,
            source_hash, doc_order, has_unapplied_effects, effects_checked_at)
         values ($1, $2, $3, $4, $5, $6, $7, false, now())`,
        [
          provision.id,
          legislationFixture.identity,
          provision.labelPath,
          provision.label,
          `Text of ${provision.label}.`,
          `dbtest-v2-${index}`,
          index,
        ],
      )
    }
    await pool.query(
      `insert into legislation_documents
         (identity, act_type, year, number, title, source_url, content_hash)
       values ($1, 'ukpga', 2099, 2, $2, $3, 'dbtest-v2-empty')`,
      [
        emptyActIdentity,
        'Empty Test Act 2099',
        `https://www.legislation.gov.uk/${emptyActIdentity}`,
      ],
    )
  })

  afterAll(async () => {
    await pool.query(
      `delete from legal_source_documents where document_id like 'db-test-v2-%'`,
    )
    await pool.query(`delete from legislation_provisions where id like $1`, [
      'ukpga/2099/1/%',
    ])
    await pool.query(
      `delete from legislation_documents where identity like 'ukpga/2099/%'`,
    )
    await pool.end()
  })

  it('clears an exact neutral citation match and preserves its source id', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 1'),
      normalizedCitation: caseLaw('[2099] UKSC 1', 'db-test-v2-uksc-1'),
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.normalizedCitation).toEqual(
      caseLaw('[2099] UKSC 1', 'db-test-v2-uksc-1'),
    )
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        sourceId: 'db-test-v2-uksc-1',
        ordinal: 1,
        paragraphNumber: 1,
      },
    ])
  })

  it('does not treat an absent citation as an existing authority', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 999'),
      normalizedCitation: caseLaw('[2099] UKSC 999', 'db-test-v2-uksc-999'),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.evidence).toEqual([])
    expect(finding.explanation.toLowerCase()).not.toContain('does not exist')
  })

  it('matches a citation case and spacing variant through the canonical fold', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099]  uksc   1'),
      normalizedCitation: caseLaw('[2099]  uksc   1', 'db-test-v2-uksc-1'),
    })

    expect(finding.status).toEqual({ state: 'clear' })
  })

  it('matches a zero-padded tribunal citation through the canonical fold', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKUT 236 (IAC)'),
      normalizedCitation: caseLaw('[2099] UKUT 236 (IAC)', 'db-test-v2-pad'),
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence[0]?.sourceId).toBe('db-test-v2-pad')
  })

  it('treats duplicate stored citations as ambiguous, never a winner', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 777'),
      normalizedCitation: caseLaw('[2099] UKSC 777', 'db-test-v2-dup-a'),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.evidence).toEqual([])
  })

  it('reports a withdrawn stored source as unavailable, not not-held', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 3'),
      normalizedCitation: caseLaw('[2099] UKSC 3', 'db-test-v2-withdrawn'),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('does not treat a keyword query as an exact authority', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('UKSC 1'),
      normalizedCitation: caseLaw('UKSC 1', 'db-test-v2-uksc-1'),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
  })

  it('withholds a clear when a held judgment has no addressable paragraph', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 4'),
      normalizedCitation: caseLaw('[2099] UKSC 4', 'db-test-v2-summary-only'),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('clears a held whole Act and anchors its evidence in the Act', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('/ln/ukpga/2099/1'),
      normalizedCitation: legislation(legislationFixture.identity, null),
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence[0]).toMatchObject({
      sourceType: 'legislation_provision',
      sourceId: legislationFixture.identity,
    })
  })

  it('clears an exact held provision and preserves its label path', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('/ln/ukpga/2099/1/section/40'),
      normalizedCitation: legislation(
        legislationFixture.identity,
        'section/40',
      ),
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        sourceId: legislationFixture.identity,
        labelPath: 'section/40',
      },
    ])
  })

  it('reports a missing Act as not held', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('/ln/ukpga/2099/3'),
      normalizedCitation: legislation('ukpga/2099/3', null),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
  })

  it('does not confuse a missing provision with a missing Act', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('/ln/ukpga/2099/1/section/99'),
      normalizedCitation: legislation(
        legislationFixture.identity,
        'section/99',
      ),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.explanation.toLowerCase()).toContain('act')
    expect(finding.explanation.toLowerCase()).toContain('held')
  })

  it('withholds a clear when a held Act has no addressable provision', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('/ln/ukpga/2099/2'),
      normalizedCitation: legislation(emptyActIdentity, null),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('turns a store failure into an inconclusive check, never not-held', async () => {
    const failingPool = {
      query: async () => {
        throw new Error('connection terminated unexpectedly')
      },
    } as unknown as Pick<Pool, 'query'>

    const outcome = await lookupAuthorityExistence(
      failingPool,
      caseLaw('[2099] UKSC 1', 'db-test-v2-uksc-1'),
    )
    expect(outcome).toEqual({ outcome: 'unavailable', reason: 'store_error' })

    const finding = await checkAuthorityExistence(failingPool, {
      subject,
      citation: citation('[2099] UKSC 1'),
      normalizedCitation: caseLaw('[2099] UKSC 1', 'db-test-v2-uksc-1'),
    })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.explanation).not.toContain('connection terminated')
  })

  it('never touches the store for a citation that did not resolve', async () => {
    const failingPool = {
      query: async () => {
        throw new Error('the store must not be read')
      },
    } as unknown as Pick<Pool, 'query'>

    const finding = await checkAuthorityExistence(failingPool, {
      subject,
      citation: citation('[2099] UKSC'),
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
  })

  it('never touches the store for an unrun check', async () => {
    const failingPool = {
      query: async () => {
        throw new Error('the store must not be read')
      },
    } as unknown as Pick<Pool, 'query'>

    const finding = await checkAuthorityExistence(failingPool, {
      subject,
      citation: citation('[2099] UKSC 1'),
      normalizedCitation: { kind: 'not_checked' },
    })

    expect(finding.status).toEqual({ state: 'not_checked' })
  })

  it('fails closed when the citation source id disagrees with the stored match', async () => {
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 1'),
      normalizedCitation: caseLaw('[2099] UKSC 1', 'db-test-v2-uksc-2'),
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('reproduces the same finding id for the same subject, type and location', async () => {
    const first = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 1'),
      normalizedCitation: caseLaw('[2099] UKSC 1', 'db-test-v2-uksc-1'),
    })
    const second = await checkAuthorityExistence(pool, {
      subject,
      citation: citation('[2099] UKSC 2'),
      normalizedCitation: caseLaw('[2099] UKSC 2', 'db-test-v2-uksc-2'),
    })

    expect(first.id).toBe(second.id)
  })
})

async function insertAuthority(pool: Pool, fixture: AuthorityFixture) {
  const summary = {
    id: fixture.id,
    title: `Stored ${fixture.neutralCitation}`,
    neutralCitation: fixture.neutralCitation,
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2099-01-15',
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
    contentHash: `dbtest-v2-${fixture.id}`,
    ...(fixture.withdrawn
      ? {
          withdrawn: {
            at: '2099-09-01T00:00:00.000Z',
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
