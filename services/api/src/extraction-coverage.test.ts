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

// Synthetic reconstruction of the pre-fix collapse artifact on an all-caps
// claim form (never real legal text): pairs/triples fused, longest token 18
// (PARTICULARSOFCLAIM), 0% of chars in tokens over 30 — the old token signal
// passed this, so the letter-run signal must catch it.
const PREF_FIX_FUSED_CLAIM_FORM =
  'INTHECOUNTY COURTATCENTRAL LONDON\n' +
  'PARTICULARSOFCLAIM\n' +
  'Claim number KB-2024-018734\n' +
  'The Claimant seeks damages of GBP 18,420.00\n' +
  'NI number QQ 12 34 56 C was recorded'

describe('extraction coverage guard', () => {
  it('passes the footnotes fixture once extraction carries the note bodies', async () => {
    const source = await corpus('letter-footnotes-numbering.docx')
    const { text } = await extractDocumentContent('docx', source)
    // Probe from word/footnotes.xml, absent before E43.
    expect(text).toContain('disclosure timetable agreed on 2 May')
    await expect(
      findUncoveredRegions({
        filename: 'letter-footnotes-numbering.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sourceBytes: source,
        extractedText: text,
      }),
    ).resolves.toEqual([])
  })

  it('still refuses runs whose stored text predates footnote extraction', async () => {
    const regions = await findUncoveredDocxRegions(
      await corpus('letter-footnotes-numbering.docx'),
      'Synthetic text.',
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
      const source = await corpus(name)
      const { text } = await extractDocumentContent('docx', source)
      await expect(
        findUncoveredDocxRegions(source, text),
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

  it('flags the pre-fix fused claim-form extraction via the letter-run signal', () => {
    const tokens = PREF_FIX_FUSED_CLAIM_FORM.split(/\s+/u).filter(Boolean)
    const longest = Math.max(...tokens.map((token) => [...token].length))
    expect(longest).toBe(18)
    const regions = findUncoveredPdfRegions(PREF_FIX_FUSED_CLAIM_FORM)
    expect(regions).toHaveLength(1)
    expect(regions[0]).toContain('fused-text')
    expect(regions[0]).toContain('letter run')
  })

  it('passes ordinary prose through both PDF signals', () => {
    expect(
      findUncoveredPdfRegions(
        'Dear Solicitor, please find enclosed the disclosure timetable agreed on 2 May.',
      ),
    ).toEqual([])
    expect(findUncoveredPdfRegions('')).toEqual([])
  })

  it('passes prose carrying a legit long word', () => {
    // "distinguishable" (15 letters) is the longest clean run observed
    // outside PDFs; it stays under the 16-letter minimum.
    expect(
      findUncoveredPdfRegions(
        'The disclosure was clearly distinguishable from the earlier draft timetable.',
      ),
    ).toEqual([])
  })

  it('passes a single long word diluted in a long document', () => {
    // The share gate (not longest alone) keeps one legit 18-letter word in a
    // long document passing.
    const text = `misrepresentation ${'ordinary prose words '.repeat(200)}`
    expect(findUncoveredPdfRegions(text)).toEqual([])
  })

  it('passes clean extracted PDFs (all text-layer fixtures)', async () => {
    for (const name of [
      'pdf-text-layer-fixture.pdf',
      'pdf-spaced-pii-fixture.pdf',
      'pdf-short-text-layer-fixture.pdf',
    ]) {
      const pdf = await readFile(`../../data/evals/redact/${name}`)
      const { text } = await extractDocumentContent('pdf', pdf)
      expect(text.trim().length).toBeGreaterThan(0)
      await expect(
        findUncoveredRegions({
          filename: name,
          mimeType: 'application/pdf',
          sourceBytes: pdf,
          extractedText: text,
        }),
        name,
      ).resolves.toEqual([])
    }
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
