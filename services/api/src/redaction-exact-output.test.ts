import { expect, it } from 'bun:test'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
import { buildRedactedDocx } from './redaction-docx-output'

it('burns accepted STATE coordinates without changing STATEMENT or an unaccepted duplicate', async () => {
  const text = 'STATEMENT OF THE CLAIMANT: STATE and STATE'
  const start = text.indexOf('STATE', 10)
  const output = await buildRedactedDocx({
    docxBytes: Buffer.from(await createSyntheticDocx([text])),
    text,
    spans: [{ id: 'accepted', start, end: start + 5, text: 'STATE', category: 'person_name', source: 'rampart_model', confidence: 'high', suggestion: 'redact' }],
    decisions: { accepted: { decision: 'accept', decidedBy: 'test', decidedAt: '2026-10-29T00:00:00Z' } },
    outputMode: 'pseudonymised',
    tokenMap: { PERSON_NAME_1: 'STATE' },
  })
  const document = await parseDocx(output)
  expect(document.model.stories.flatMap(s => s.paragraphs.map(p => p.runs.map(r => r.text).join(''))).join('\n')).toBe('STATEMENT OF THE CLAIMANT: [PERSON_NAME_1] and STATE')
})
