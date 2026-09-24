import { describe, expect, it } from 'bun:test'
import { collectVerificationFindings } from './verification-checks'
import { fakePool } from './citation-resolution.test-support'
import { queryDouble, queryResult } from './query-double.test-support'

const subject = { documentId: 'doc_1', versionId: 'ver_1' }

describe('collectVerificationFindings', () => {
  it('maps an unresolved citation through V3 and V2 without inventing a pass', async () => {
    const { pool } = fakePool({ authorities: [] })
    const findings = await collectVerificationFindings(
      pool,
      subject,
      [
        {
          id: 'p1:4:17',
          paragraphId: 'p1',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          locationParagraphId: 'document\u001fword/document.xml\u001fp1',
          start: 4,
          end: 17,
          rawText: '[2024] UKSC 1',
        },
      ],
      [],
    )
    expect(findings.map((finding) => finding.type)).toEqual([
      'citation_resolution',
      'authority_existence',
    ])
    expect(findings.every((finding) => finding.id.startsWith('vf:'))).toBe(true)
    expect(
      findings.some(
        (finding) =>
          finding.status.state === 'clear' ||
          finding.status.state === 'flagged',
      ),
    ).toBe(false)
  })

  it('records an unattributed quotation as uncertain rather than a mismatch', async () => {
    const { pool } = fakePool({ authorities: [] })
    const findings = await collectVerificationFindings(
      pool,
      subject,
      [],
      [
        {
          id: 'document\u001fword/document.xml\u001fp1:0:23',
          paragraphId: 'p1',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          locationParagraphId: 'document\u001fword/document.xml\u001fp1',
          start: 0,
          end: 23,
          rawText: 'the court must consider',
          attributedCitationId: null,
          attribution: 'none',
        },
      ],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.type).toBe('quote_fidelity')
    expect(findings[0]?.status.state).not.toBe('flagged')
    expect(findings[0]?.id).not.toContain('the court must consider')
  })

  it('turns an ambiguous quote association into review-required, not a guess', async () => {
    const { pool } = fakePool({ authorities: [] })
    const findings = await collectVerificationFindings(
      pool,
      subject,
      [],
      [
        {
          id: 'document\u001fword/document.xml\u001fp1:0:23',
          paragraphId: 'p1',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          locationParagraphId: 'document\u001fword/document.xml\u001fp1',
          start: 0,
          end: 23,
          rawText: 'the court must consider',
          attributedCitationId: null,
          attribution: 'ambiguous',
        },
      ],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.type).toBe('quote_fidelity')
    // The structured reason reaches the UI, so the quote is visibly not checked
    // against a guessed authority.
    expect(findings[0]?.status).toEqual({
      state: 'review_required',
      reason: 'citation_ambiguous',
    })
  })

  it('confines a failed store read to the finding that needed it', async () => {
    // Resolution succeeds, so the citation has an identity; the authority
    // lookup for that identity fails to read, and so does the quotation's
    // source. Neither failure may abort the batch or turn into a pass.
    const { pool } = queryDouble((text) => {
      if (text.includes('like any')) {
        return queryResult([
          {
            documentId: 'uksc-1',
            neutralCitation: '[2024] UKSC 1',
            providerJson: {},
          },
        ])
      }
      if (text.includes('where document_id = $1')) {
        throw new Error('source store is down')
      }
      throw new Error(`Unexpected query: ${text}`)
    })
    const findings = await collectVerificationFindings(
      pool,
      subject,
      [
        {
          id: 'p1:4:17',
          paragraphId: 'p1',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          locationParagraphId: 'document\u001fword/document.xml\u001fp1',
          start: 4,
          end: 17,
          rawText: '[2024] UKSC 1',
        },
      ],
      [
        {
          id: 'document\u001fword/document.xml\u001fp1:18:41',
          paragraphId: 'p1',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          locationParagraphId: 'document\u001fword/document.xml\u001fp1',
          start: 18,
          end: 41,
          rawText: 'the court must consider',
          attributedCitationId: 'p1:4:17',
          attribution: 'attributed',
        },
      ],
    )

    // The resolution check completed on its own facts; the two checks that
    // needed a source read stayed uncertain rather than aborting the batch or
    // inventing a verdict.
    expect(
      findings.map((finding) => `${finding.type}:${finding.status.state}`),
    ).toEqual([
      'citation_resolution:clear',
      'authority_existence:review_required',
      'quote_fidelity:review_required',
    ])
  })
})
