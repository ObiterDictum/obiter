import { describe, expect, it } from 'bun:test'
import { decideCitationResolution } from '@obiter/verification-core'
import {
  candidates,
  citationOf,
  fakePool,
} from './citation-resolution.test-support'
import { resolveCitationCandidates } from './citation-resolution'

const subject = { documentId: 'd-contract', versionId: 'v-1' }

async function findingsFor(rawTexts: string[]) {
  const { pool } = fakePool()
  const results = await resolveCitationCandidates(pool, candidates(...rawTexts))
  return results.map((result, index) =>
    decideCitationResolution({
      subject,
      citation: citationOf(rawTexts[index]!),
      resolution: result!.resolution,
    }),
  )
}

describe('citation resolution finding boundary', () => {
  it.each([
    '0204 c. 1',
    '0000 c. 1',
    '2066 c. 0',
    '2066 c. 99999999999999999999',
  ])('turns %j into a finding instead of throwing', async (rawText) => {
    const [finding] = await findingsFor([rawText])

    expect(finding!.status).toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
    expect(finding!.normalizedCitation).toEqual({
      kind: 'unresolved',
      reason: 'not_a_citation',
    })
  })

  it('keeps valid siblings when one batch candidate is malformed', async () => {
    const findings = await findingsFor(['2066 c. 1', '0204 c. 1', '2066 c. 99'])

    expect(findings.map((finding) => finding.status)).toEqual([
      { state: 'clear' },
      { state: 'review_required', reason: 'citation_unresolved' },
      { state: 'clear' },
    ])
  })

  it.each(['[2024] EAT 12', '[2024] NICh 3', '[2024] ScotCS 7'])(
    'reports the well-formed unlisted court %j as unsupported with no store read',
    async (rawText) => {
      const { pool, calls } = fakePool()
      const [result] = await resolveCitationCandidates(
        pool,
        candidates(rawText),
      )

      expect(result!.resolution).toEqual({ outcome: 'unsupported' })
      expect(calls).toHaveLength(0)

      const finding = decideCitationResolution({
        subject,
        citation: citationOf(rawText),
        resolution: result!.resolution,
      })
      expect(finding.status).toEqual({
        state: 'review_required',
        reason: 'citation_unresolved',
      })
      expect(finding.normalizedCitation).toEqual({
        kind: 'unresolved',
        reason: 'unsupported_source_type',
      })
    },
  )

  it('keeps prose that merely contains brackets and digits malformed', async () => {
    const findings = await findingsFor([
      'the policy in [2024] and 12 files',
      '[2024] Foo Bar 12',
    ])

    expect(findings.map((finding) => finding.normalizedCitation)).toEqual([
      { kind: 'unresolved', reason: 'not_a_citation' },
      { kind: 'unresolved', reason: 'not_a_citation' },
    ])
  })
})
