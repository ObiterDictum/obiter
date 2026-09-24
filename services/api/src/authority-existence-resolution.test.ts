import { describe, expect, it } from 'bun:test'
import {
  classifyLegislationCitation,
  createActDirectory,
} from './routes/legal-search/legislation-citations'
import {
  decideAuthorityExistence,
  type CitationInput,
  type VerificationSubject,
} from '@obiter/verification-core'

/**
 * The seam V2 sits behind. Free-text legislation citations are resolved by the
 * existing Search classifier and title fold; V2 only ever sees the canonical
 * identity that resolution produces. These pin the cases the slice names
 * (ambiguous titles, the `(repealed)` annotation, apostrophe and case folding)
 * at the seam so V2 is not tempted to reimplement them.
 *
 * Pure: no store, no database. The same resolution is exercised end to end in
 * `authority-existence.db.test.ts`.
 */

const subject: VerificationSubject = { documentId: 'd-v2', versionId: 'v-1' }

function citation(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-1', start: 0, end: rawText.length },
  }
}

describe('authority existence resolution boundary', () => {
  it('reuses the existing title fold to reach the identity it checks', () => {
    const directory = createActDirectory([
      {
        actType: 'ukpga',
        year: 2099,
        number: 3,
        identity: 'ukpga/2099/3',
        title: 'Children’s Rights (Amendment) Act 2099',
      },
    ])

    const outcome = classifyLegislationCitation(
      "children's rights amendment act 2099",
      directory,
    )

    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act') {
      expect(outcome.act.identity).toBe('ukpga/2099/3')
    }
  })

  it('resolves the repealed title annotation the citation fold owns', () => {
    const directory = createActDirectory([
      {
        actType: 'ukpga',
        year: 2099,
        number: 1,
        identity: 'ukpga/2099/1',
        title: 'Test Authority Act 2099',
      },
    ])

    const outcome = classifyLegislationCitation(
      'Test Authority Act 2099 (repealed)',
      directory,
    )

    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act') {
      expect(outcome.act.identity).toBe('ukpga/2099/1')
    }
  })

  it('keeps an ambiguous title ambiguous so V2 reviews rather than guesses', () => {
    const directory = createActDirectory([
      {
        actType: 'ukpga',
        year: 2099,
        number: 1,
        identity: 'ukpga/2099/1',
        title: 'Test Authority Act 2099',
      },
      {
        actType: 'ukpga',
        year: 2099,
        number: 9,
        identity: 'ukpga/2099/9',
        title: 'Test Authority Act 2099',
      },
    ])

    const outcome = classifyLegislationCitation(
      'Test Authority Act 2099',
      directory,
    )
    expect(outcome.kind).toBe('ambiguous')

    const finding = decideAuthorityExistence({
      subject,
      citation: citation('Test Authority Act 2099'),
      normalizedCitation: { kind: 'unresolved', reason: 'ambiguous' },
      outcome: { outcome: 'skipped' },
    })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_ambiguous',
    })
  })
})
