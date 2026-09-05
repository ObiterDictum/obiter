import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { extractDocumentContent } from './document-extraction'
import {
  countBodyTextboxChars,
  findUncoveredDocxRegions,
  findUncoveredPdfRegions,
  findUncoveredRegions,
} from './extraction-coverage'

const corpus = (name: string) => readFile(`test-fixtures/upload-corpus/${name}`)

describe('extraction coverage guard', () => {
  it('flags footnote bodies the extractor never reads', async () => {
    const regions = await findUncoveredDocxRegions(
      await corpus('letter-footnotes-numbering.docx'),
    )
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatch(/^footnotes \(\d+ chars not examined\)$/)
  })

  it('passes clean documents (plain, table, tracked-changes)', async () => {
    for (const name of [
      'letter-plain.docx',
      'letter-table.docx',
      'letter-tracked-changes.docx',
    ]) {
      await expect(
        findUncoveredDocxRegions(await corpus(name)),
        name,
      ).resolves.toEqual([])
    }
  })

  it('counts body textbox text as unexamined', () => {
    const xml =
      '<w:body><w:p><w:r><w:t>visible</w:t></w:r></w:p>' +
      '<w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>hidden textbox prose here</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p></w:body>'
    expect(countBodyTextboxChars(xml)).toBeGreaterThanOrEqual(20)
    expect(
      countBodyTextboxChars('<w:body><w:p><w:t>hi</w:t></w:p></w:body>'),
    ).toBe(0)
  })

  it('detects fused PDF text via the long-token signal', () => {
    const fused = `Dear Solicitor ${'HelloWorldthisisafusedrunoftextwithnospacesatall'.repeat(3)} end`
    const regions = findUncoveredPdfRegions(fused)
    expect(regions).toHaveLength(1)
    expect(regions[0]).toContain('fused-text')
  })

  it('passes ordinary prose through the PDF signal', () => {
    expect(
      findUncoveredPdfRegions(
        'Dear Solicitor, please find enclosed the disclosure timetable agreed on 2 May.',
      ),
    ).toEqual([])
    expect(findUncoveredPdfRegions('')).toEqual([])
  })

  it('passes a clean extracted PDF (text-layer fixture)', async () => {
    const pdf = await readFile(
      '../../data/evals/redact/pdf-text-layer-fixture.pdf',
    )
    const { text } = await extractDocumentContent('pdf', pdf)
    expect(text.trim().length).toBeGreaterThan(0)
    await expect(
      findUncoveredRegions({
        filename: 'fixture.pdf',
        mimeType: 'application/pdf',
        sourceBytes: pdf,
        extractedText: text,
      }),
    ).resolves.toEqual([])
  })

  it('leaves txt sources and missing bytes alone', async () => {
    await expect(
      findUncoveredRegions({
        filename: 'note.txt',
        mimeType: 'text/plain',
        sourceBytes: null,
        extractedText: 'anything',
      }),
    ).resolves.toEqual([])
    await expect(
      findUncoveredRegions({
        filename: 'letter.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sourceBytes: null,
        extractedText: 'anything',
      }),
    ).resolves.toEqual([])
  })
})
