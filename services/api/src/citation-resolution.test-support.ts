import type { Pool, QueryResultRow } from 'pg'
import {
  normalizedCitationFromResolution,
  type CitationInput,
  type CitationResolution,
  type NormalizedCitation,
  type VerificationFinding,
  type VerificationSubject,
} from '@obiter/verification-core'
import { checkAuthorityExistence } from './authority-existence'
import {
  resolveCitationCandidates,
  type CitationCandidate,
} from './citation-resolution'

/**
 * Injected-pool fixtures for the citation-resolution tests. The fake answers
 * the two real queries the resolver issues, filtering the candidate lookup the
 * way the SQL year predicate and the exact fold do, so a test failure points at
 * the orchestration rather than at a fake that agrees with anything. The live
 * pipeline helper at the end is what the database tests use.
 */

export function citationOf(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-1', start: 0, end: rawText.length },
  }
}

export interface AuthorityRow extends QueryResultRow {
  documentId: string
  neutralCitation: string
  /** Not read by resolution. Present so a test can prove it is not read. */
  withdrawn?: boolean
}

export interface ActRow extends QueryResultRow {
  identity: string
  actType: 'ukpga'
  year: number
  number: number
  title: string
  sourceUrl: string
  extent: string
}

export const actRow = (number: number, title: string): ActRow => ({
  identity: `ukpga/2066/${number}`,
  actType: 'ukpga',
  year: 2066,
  number,
  title,
  sourceUrl: `https://www.legislation.gov.uk/ukpga/2066/${number}`,
  extent: '',
})

/** Titles chosen so each fold under test (case, quote, hyphen, `(repealed)`,
 * alias) has exactly one stored Act to converge on. */
export const actRows: ActRow[] = [
  actRow(1, 'Test Authority Act 2066'),
  actRow(2, 'Duplicate Title Act 2066'),
  actRow(3, 'Duplicate Title Act 2066'),
  actRow(4, 'Children\u2019s Test Act 2066'),
  actRow(5, 'Repealed Test Act 2066 (repealed)'),
  actRow(6, 'Co-operative Test Act 2066'),
  {
    identity: 'ukpga/1998/42',
    actType: 'ukpga',
    year: 1998,
    number: 42,
    title: 'Human Rights Act 1998',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/1998/42',
    extent: '',
  },
]

export interface FakePoolOptions {
  authorities?: AuthorityRow[]
  failAuthorities?: boolean
  failActs?: boolean
}

export function fakePool(options: FakePoolOptions = {}) {
  const calls: Array<{ table: string; text: string; values: unknown[] }> = []
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes('legal_source_documents')) {
        calls.push({ table: 'authorities', text, values })
        if (options.failAuthorities) {
          throw new Error('connection terminated unexpectedly')
        }
        const patterns = (values[0] as string[] | undefined) ?? []
        const rows = (options.authorities ?? []).filter((row) =>
          patterns.length === 0
            ? true
            : patterns.some((pattern) =>
                row.neutralCitation.includes(pattern.replaceAll('%', '')),
              ),
        )
        return { rows }
      }
      if (text.includes('legislation_documents')) {
        calls.push({ table: 'legislation', text, values })
        if (options.failActs) throw new Error('legislation store is down')
        return { rows: actRows }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
  }
  return { pool: pool as unknown as Pick<Pool, 'query'>, calls }
}

export const candidates = (...rawTexts: string[]): CitationCandidate[] =>
  rawTexts.map((rawText) => ({ id: rawText, rawText }))

/** Resolve one candidate's text through the batch boundary and return the V1
 * citation state it maps to, so a test reads as the one call it is. */
export async function resolveOne(
  rawText: string,
  options: FakePoolOptions = {},
): Promise<NormalizedCitation> {
  const { pool } = fakePool(options)
  const [result] = await resolveCitationCandidates(pool, candidates(rawText))
  return normalizedCitationFromResolution(result!.resolution)
}

export async function outcomeOf(
  rawText: string,
  options: FakePoolOptions = {},
): Promise<string> {
  const { pool } = fakePool(options)
  const [result] = await resolveCitationCandidates(pool, candidates(rawText))
  return result!.resolution.outcome
}

/**
 * The documented pipeline against a live pool: resolve the raw candidate, then
 * check the identity resolution produced. `checkAuthorityExistence` runs its own
 * lookup, so a test asserts the full V3 to V2 hand-off rather than a stitched
 * copy of it.
 */
export function createResolutionPipeline(
  pool: Pick<Pool, 'query'>,
  subject: VerificationSubject,
) {
  async function resolve(rawTexts: string[]): Promise<CitationResolution[]> {
    const results = await resolveCitationCandidates(
      pool,
      rawTexts.map((rawText, index) => ({ id: `c-${index}`, rawText })),
    )
    return results.map((result) => result.resolution)
  }

  async function resolveOne(rawText: string): Promise<CitationResolution> {
    const [resolution] = await resolve([rawText])
    if (!resolution) throw new Error('Resolution returned no result.')
    return resolution
  }

  async function resolveThenCheck(rawText: string): Promise<{
    resolution: CitationResolution
    finding: VerificationFinding
  }> {
    const resolution = await resolveOne(rawText)
    const finding = await checkAuthorityExistence(pool, {
      subject,
      citation: citationOf(rawText),
      normalizedCitation: normalizedCitationFromResolution(resolution),
    })
    return { resolution, finding }
  }

  return { resolve, resolveOne, resolveThenCheck }
}
