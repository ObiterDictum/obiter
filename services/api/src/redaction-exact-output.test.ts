import JSZip from 'jszip'
import { extractRedactionContent } from './redaction-extraction'
import { expect, it } from 'bun:test'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
import { buildRedactedDocx } from './redaction-docx-output'

it('burns accepted STATE coordinates without changing STATEMENT or an unaccepted duplicate', async () => {
  const text = 'STATEMENT OF THE CLAIMANT: STATE and STATE'
  const start = text.indexOf('STATE', 10)
  const output = await buildRedactedDocx({
    docxBytes: Buffer.from(await createSyntheticDocx([text])),
    text,
    spans: [
      {
        id: 'accepted',
        start,
        end: start + 5,
        text: 'STATE',
        category: 'person_name',
        source: 'rampart_model',
        confidence: 'high',
        suggestion: 'redact',
      },
    ],
    decisions: {
      accepted: {
        decision: 'accept',
        decidedBy: 'test',
        decidedAt: '2026-10-29T00:00:00Z',
      },
    },
    outputMode: 'pseudonymised',
    tokenMap: { PERSON_NAME_1: 'STATE' },
  })
  const document = await parseDocx(output)
  expect(
    document.model.stories
      .flatMap((s) =>
        s.paragraphs.map((p) => p.runs.map((r) => r.text).join('')),
      )
      .join('\n'),
  ).toBe('STATEMENT OF THE CLAIMANT: [PERSON_NAME_1] and STATE')
})

it.each(['header1', 'footer1', 'endnotes'])(
  'burns selected text in %s while preserving its rejected duplicate',
  async (story) => {
    const zip = await JSZip.loadAsync(
      await createSyntheticDocx(['Public body']),
    )
    const paragraph = '<w:p><w:r><w:t>Jane Doe and Jane Doe</w:t></w:r></w:p>'
    const root =
      story === 'header1' ? 'hdr' : story === 'footer1' ? 'ftr' : 'endnotes'
    zip.file(
      `word/${story}.xml`,
      `<w:${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${story === 'endnotes' ? `<w:endnote w:id="1">${paragraph}</w:endnote>` : paragraph}</w:${root}>`,
    )
    const docxBytes = Buffer.from(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const { text } = await extractRedactionContent('docx', docxBytes)
    const start = text.indexOf('Jane Doe')
    const output = await buildRedactedDocx({
      docxBytes,
      text,
      spans: [
        {
          id: 'selected',
          start,
          end: start + 8,
          text: 'Jane Doe',
          category: 'person_name',
          source: 'rampart_model',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
      decisions: {
        selected: {
          decision: 'accept',
          decidedBy: 'test',
          decidedAt: '2026-10-29T00:00:00Z',
        },
      },
      outputMode: 'pseudonymised',
      tokenMap: { PERSON_NAME_1: 'Jane Doe' },
    })
    expect(
      (await extractRedactionContent('docx', Buffer.from(output))).text,
    ).toBe(text.slice(0, start) + '[PERSON_NAME_1]' + text.slice(start + 8))
  },
)
