import type { Pool } from 'pg'
import type {
  CitationInput,
  NormalizedCitation,
  VerificationSubject,
} from '@obiter/verification-core'
import type { QuoteFidelityRequest } from './quote-fidelity'

/**
 * Shared fixtures for the quote-fidelity tests. The injected fake answers the
 * real queries the store issues; the real-database inserters write the same
 * shapes the store reads. Keeping both here means the fake and the fixtures
 * cannot drift from each other unnoticed.
 */

export const subject: VerificationSubject = {
  documentId: 'd-4',
  versionId: 'v-1',
}

export function quote(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-1', start: 0, end: rawText.length },
  }
}

export function request(
  quoteText: string,
  normalizedCitation: NormalizedCitation,
): QuoteFidelityRequest {
  return { subject, quote: quote(quoteText), normalizedCitation }
}

export const caseLaw: NormalizedCitation = {
  kind: 'case_law',
  neutralCitation: '[2066] UKSC 1',
  sourceId: 'db-test-v4-uksc',
}

export const legislation: NormalizedCitation = {
  kind: 'legislation',
  documentIdentity: 'ukpga/2066/1',
  labelPath: 'section/40',
}

export function judgmentCitation(sourceId: string): NormalizedCitation {
  return { kind: 'case_law', neutralCitation: '[2066] UKSC 1', sourceId }
}

export interface ParagraphFixture {
  paragraphNumber: number
  text: string
}

export interface AuthorityFixture {
  id: string
  /** Overrides the stored document id, to exercise identity mismatch. */
  documentId?: string
  withdrawn?: boolean
  malformed?: boolean
  paragraphs?: ParagraphFixture[]
}

export interface ProvisionFixture {
  labelPath: string
  text: string
  hasUnappliedEffects?: boolean
  effectsCheckedAt?: string | null
}

export interface ActFixture {
  identity: string
  year: number
  number: number
  title: string
  provisions: ProvisionFixture[]
}

export function authoritySummary(id: string) {
  return {
    id,
    title: `Stored ${id}`,
    neutralCitation: '[2066] UKSC 1',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2066-01-15',
    sourceType: 'judgment',
    sourceUrl: `https://caselaw.nationalarchives.gov.uk/${id}`,
  }
}

export function actRow(act: ActFixture) {
  return {
    identity: act.identity,
    actType: 'ukpga',
    year: act.year,
    number: act.number,
    title: act.title,
    sourceUrl: `https://www.legislation.gov.uk/${act.identity}`,
    extent: '',
  }
}

export const judgmentAuthority: AuthorityFixture = {
  id: 'db-test-v4-uksc',
  paragraphs: [
    { paragraphNumber: 1, text: 'The court began here.' },
    { paragraphNumber: 2, text: 'the court must consider the point' },
  ],
}

export const act: ActFixture = {
  identity: 'ukpga/2066/1',
  year: 2066,
  number: 1,
  title: 'Test Authority Act 2066',
  provisions: [
    {
      labelPath: 'section/40',
      text: 'A public authority must not act incompatibly with the Convention.',
    },
    { labelPath: 'section/99', text: 'A different provision entirely.' },
  ],
}

export function fakeQuotePool(options: {
  authorities?: AuthorityFixture[]
  acts?: ActFixture[]
  fail?: 'authorities' | 'legislation'
}) {
  const calls: Array<{ text: string; values: unknown[] }> = []
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values })
      if (text.includes('from legal_source_documents')) {
        if (options.fail === 'authorities') {
          throw new Error('connection terminated unexpectedly')
        }
        const id = values[0] as string
        const fixture = options.authorities?.find((entry) => entry.id === id)
        if (!fixture) return { rows: [] }
        const summary = authoritySummary(fixture.documentId ?? fixture.id)
        if (fixture.malformed) {
          return {
            rows: [
              {
                summary_json: { id: summary.id },
                document_json: null,
                provider_json: {},
              },
            ],
          }
        }
        const document = fixture.paragraphs
          ? {
              ...summary,
              paragraphs: fixture.paragraphs.map((paragraph, index) => ({
                id: `${summary.id}-p${index + 1}`,
                documentId: summary.id,
                paragraphNumber: paragraph.paragraphNumber,
                text: paragraph.text,
              })),
            }
          : null
        return {
          rows: [
            {
              summary_json: summary,
              document_json: document,
              provider_json: fixture.withdrawn
                ? {
                    withdrawn: {
                      at: '2066-09-01T00:00:00.000Z',
                      checkedUris: [summary.id],
                      runIds: ['run-0'],
                    },
                  }
                : {},
            },
          ],
        }
      }
      if (text.includes('from legislation_documents where identity')) {
        if (options.fail === 'legislation') {
          throw new Error('legislation store is down')
        }
        const identity = values[0] as string
        const match = options.acts?.find((entry) => entry.identity === identity)
        return { rows: match ? [actRow(match)] : [] }
      }
      if (text.includes('select exists')) {
        const [identity, labelPath] = values as [string, string]
        const match = options.acts?.find((entry) => entry.identity === identity)
        const exists =
          match?.provisions.some(
            (provision) =>
              provision.labelPath === labelPath ||
              provision.labelPath.startsWith(`${labelPath}/`),
          ) ?? false
        return { rows: [{ exists }] }
      }
      if (text.includes('from legislation_provisions p')) {
        const id = values[0] as string
        for (const current of options.acts ?? []) {
          const provision = current.provisions.find(
            (entry) => `${current.identity}/${entry.labelPath}` === id,
          )
          if (provision) {
            return {
              rows: [
                {
                  id,
                  documentIdentity: current.identity,
                  labelPath: provision.labelPath,
                  label: provision.labelPath,
                  extent: '',
                  text: provision.text,
                  hasUnappliedEffects: provision.hasUnappliedEffects ?? false,
                  effectsCheckedAt:
                    provision.effectsCheckedAt === undefined
                      ? '2066-01-01T00:00:00.000Z'
                      : provision.effectsCheckedAt,
                  title: current.title,
                  year: current.year,
                  sourceUrl: `https://www.legislation.gov.uk/${current.identity}`,
                },
              ],
            }
          }
        }
        return { rows: [] }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
  }
  return {
    pool: pool as unknown as Pick<Pool, 'query'>,
    calls,
    queryCount: () => calls.length,
  }
}

// --- real database fixtures ---

export interface JudgmentFixture {
  id: string
  neutralCitation: string
  withdrawn?: boolean
  malformed?: boolean
  paragraphs?: Array<{ paragraphNumber: number; text: string }>
}

export const judgments: JudgmentFixture[] = [
  {
    id: 'db-test-v4-uksc',
    neutralCitation: '[2066] UKSC 1',
    paragraphs: [
      { paragraphNumber: 1, text: 'The court began with a procedural point.' },
      {
        paragraphNumber: 2,
        text: 'The court must consider the point carefully.',
      },
      {
        paragraphNumber: 3,
        text: 'The court must consider the point carefully.',
      },
      {
        paragraphNumber: 4,
        text: 'A quotation spanning two paragraphs begins',
      },
      { paragraphNumber: 5, text: 'and continues into the next one.' },
      { paragraphNumber: 6, text: 'The court must reject the point.' },
      { paragraphNumber: 7, text: 'The court must consider, the point.' },
      { paragraphNumber: 8, text: 'The defendant was not liable.' },
      {
        paragraphNumber: 9,
        text: 'A hyphe\u00adn and a \u201ccurly\u201d view.',
      },
    ],
  },
  { id: 'db-test-v4-summary-only', neutralCitation: '[2066] UKSC 4' },
  {
    id: 'db-test-v4-withdrawn',
    neutralCitation: '[2066] UKSC 3',
    withdrawn: true,
    paragraphs: [{ paragraphNumber: 1, text: 'Withdrawn source text.' }],
  },
  {
    id: 'db-test-v4-malformed',
    neutralCitation: '[2066] UKSC 5',
    malformed: true,
  },
]

export const acts: ActFixture[] = [
  {
    identity: 'ukpga/2077/1',
    year: 2077,
    number: 1,
    title: 'Test Authority Act 2077',
    provisions: [
      {
        labelPath: 'section/40',
        text: 'A public authority must not act incompatibly with the Convention rights.',
      },
      {
        labelPath: 'section/50',
        text: 'This provision has unapplied effects.',
        hasUnappliedEffects: true,
      },
      {
        labelPath: 'schedule/paragraph/4',
        text: 'The single schedule provision text.',
      },
    ],
  },
]

export async function insertJudgment(pool: Pool, fixture: JudgmentFixture) {
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
  const provider = {
    documentUri: `/${fixture.id}`,
    sourceUri: `/${fixture.id}`,
    xmlUri: null,
    pdfUri: null,
    contentHash: `dbtest-v4-${fixture.id}`,
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
  if (fixture.malformed) {
    await pool.query(
      `insert into legal_source_documents
         (document_id, summary_json, provider_json, content_hash, source_uri)
       values ($1, $2::jsonb, '{}'::jsonb, $3, $4)`,
      [
        fixture.id,
        JSON.stringify({ id: fixture.id }),
        `dbtest-v4-${fixture.id}`,
        `/${fixture.id}`,
      ],
    )
    return
  }
  const document = fixture.paragraphs
    ? {
        ...summary,
        paragraphs: fixture.paragraphs.map((paragraph, index) => ({
          id: `${fixture.id}-p${index + 1}`,
          documentId: fixture.id,
          paragraphNumber: paragraph.paragraphNumber,
          text: paragraph.text,
        })),
      }
    : null
  await pool.query(
    `insert into legal_source_documents
       (document_id, summary_json, document_json, provider_json,
        content_hash, source_uri)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)`,
    [
      fixture.id,
      JSON.stringify(summary),
      document ? JSON.stringify(document) : null,
      JSON.stringify(provider),
      provider.contentHash,
      provider.sourceUri,
    ],
  )
}

export async function insertAct(pool: Pool, act: ActFixture) {
  await pool.query(
    `insert into legislation_documents
       (identity, act_type, year, number, title, source_url, content_hash)
     values ($1, 'ukpga', $2, $3, $4, $5, $6)`,
    [
      act.identity,
      act.year,
      act.number,
      act.title,
      `https://www.legislation.gov.uk/${act.identity}`,
      `dbtest-v4-${act.identity}`,
    ],
  )
  for (const [index, provision] of act.provisions.entries()) {
    await pool.query(
      `insert into legislation_provisions
         (id, document_identity, label_path, label, provision_text,
          source_hash, doc_order, has_unapplied_effects, effects_checked_at,
          kind)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'P1')`,
      [
        `${act.identity}/${provision.labelPath}`,
        act.identity,
        provision.labelPath,
        provision.labelPath,
        provision.text,
        `dbtest-v4-${act.identity}-${index}`,
        index,
        provision.hasUnappliedEffects ?? false,
        provision.effectsCheckedAt === undefined
          ? '2066-01-01T00:00:00.000Z'
          : provision.effectsCheckedAt,
      ],
    )
  }
}
