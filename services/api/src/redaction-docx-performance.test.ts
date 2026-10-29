import { createHash } from 'node:crypto'
import { expect, it } from 'bun:test'
import { createSyntheticDocx } from '@obiter/ooxml'
import { extractRedactionContent } from './redaction-extraction'
const extractDocumentText = async (type: 'docx', bytes: Buffer) =>
  (await extractRedactionContent(type, bytes)).text
import { buildRedactedDocx } from './redaction-docx-output'

it('exports many accepted ranges without reparsing the part for every marker', async () => {
  async function measure(count: number) {
    const lines = Array.from(
      { length: count },
      (_, index) =>
        `Sensitive${index} ${createHash('sha256').update(String(index)).digest('hex')}`,
    )
    const docxBytes = Buffer.from(await createSyntheticDocx(lines))
    const text = await extractDocumentText('docx', docxBytes)
    const spans = lines.map((line, index) => {
      const name = line.split(' ')[0] ?? ''
      const start = text.indexOf(name + ' ')
      return {
        id: `s${index}`,
        start,
        end: start + name.length,
        text: name,
        category: 'person_name' as const,
        source: 'rampart_model' as const,
        confidence: 'high' as const,
        suggestion: 'redact' as const,
      }
    })
    const started = performance.now()
    const bytes = await buildRedactedDocx({
      docxBytes,
      text,
      spans,
      decisions: Object.fromEntries(
        spans.map((span) => [
          span.id,
          {
            decision: 'accept' as const,
            decidedBy: 'test',
            decidedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
      outputMode: 'redacted',
      tokenMap: {},
    })
    const elapsed = performance.now() - started
    const output = await extractDocumentText('docx', Buffer.from(bytes))
    expect(output.match(/\[REDACTED\]/gu)).toHaveLength(count)
    expect(output).not.toContain('Sensitive')
    return elapsed
  }
  const small = await measure(128)
  const large = await measure(512)
  expect(large).toBeLessThan(8_000)
  expect(large).toBeLessThan(small * 6 + 500)
}, 20_000)
