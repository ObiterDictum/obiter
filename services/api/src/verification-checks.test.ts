import { describe, expect, it } from 'vitest'
import { collectVerificationFindings } from './verification-checks'
import { fakePool } from './citation-resolution.test-support'

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
          finding.status.state === 'clear' || finding.status.state === 'flagged',
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
          paragraphId: 'p1',
          start: 0,
          end: 23,
          rawText: 'the court must consider',
          attributedCitationId: null,
        },
      ],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.type).toBe('quote_fidelity')
    expect(findings[0]?.status.state).not.toBe('flagged')
    expect(findings[0]?.id).not.toContain('the court must consider')
  })
})
