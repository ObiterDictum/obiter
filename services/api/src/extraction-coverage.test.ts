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

// Synthetic clean shorts (never real legal text): ordinary notes carrying
// the long words that tripped the old 5% letter-run gate. Measured shares
// (N=16): 5.14% over 331 letters, 5.25% over 324, 7.53% over 425,
// 8.10% over 432 — all four flagged under the old 5% gate, all passing
// under the recalibrated 10% while the fused probe above sits at 16.1%.
const CLEAN_SHORTS = [
  'Attendance note, 2 May. The client telephoned about the sale particulars for the flat. ' +
    'She said the agent had described the roof as recently replaced, but the survey records only patch repairs. ' +
    'I advised that any misrepresentation claim needs the exact wording of the statement and evidence of reliance, ' +
    'and that we should write for disclosure of the listing drafts before advising further on prospects.',
  'Advice on settlement. Counsel asks whether equity assists where the price looks one-sided. ' +
    'The doctrine of unconscionability is narrow: it requires exploitation of a serious disadvantage, not merely a hard bargain. ' +
    'On these facts the imbalance alone is unlikely to suffice, so the stronger route remains the contractual construction point, ' +
    'with the equity argument held strictly in reserve.',
  'Dear Sirs, We write concerning your continuing responsibilities for the communal areas at the property. ' +
    'The characterisation of the disputed service charge turns on the lease wording, ' +
    'and the managing agent should now produce the audited expenditure for the last two years. ' +
    'Once those accounts arrive we can advise whether any element can properly be challenged, ' +
    'and we will confirm our costs estimate for that review before any further work is done. ' +
    'We will also check the reserve fund position. Yours faithfully.',
  'File note. Counsel flagged a possible misrepresentation claim in the alternative, ' +
    'though limitation remains tight and permission may be needed before any amendment. ' +
    'The invoice is said to be disproportionately large next to the approved estimate, ' +
    'so we will compare each line against the schedule of works. ' +
    'We will also ask the surveyor to confirm which items were actually instructed on site, ' +
    'and then draft the advice with a clear view on settlement prospects before Friday. ' +
    'We will report back once the surveyor replies.',
]

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

  it('passes short legal notes carrying ordinary long words', () => {
    // Each short holds 1-2 of responsibilities/characterisation (16),
    // misrepresentation/unconscionability (17), disproportionately (18).
    for (const [index, text] of CLEAN_SHORTS.entries())
      expect(findUncoveredPdfRegions(text), `clean short ${index}`).toEqual([])
  })

  it('extracts the committed claim-form pair in both directions', async () => {
    // Reproductions of the lost V11 probe (never the original bytes): the
    // pre-fix collapse text above must flag, while the fixed extraction of
    // the well-formed bytes below is clean.
    const spaced = await corpus('claim-form-spaced.pdf')
    const fixed = await extractDocumentContent('pdf', spaced)
    expect(fixed.text).toContain('IN THE COUNTY COURT AT CENTRAL LONDON')
    expect(fixed.text).toContain('PARTICULARS OF CLAIM')
    expect(fixed.text).toContain('totalling GBP 162,526.25')
    await expect(
      findUncoveredRegions({
        filename: 'claim-form-spaced.pdf',
        mimeType: 'application/pdf',
        sourceBytes: spaced,
        extractedText: fixed.text,
      }),
      'fixed extraction is clean',
    ).resolves.toEqual([])

    const fused = await corpus('claim-form-fused.pdf')
    const fusedText = (await extractDocumentContent('pdf', fused)).text
    expect(fusedText).not.toContain('IN THE COUNTY')
    expect(findUncoveredPdfRegions(fusedText)).toEqual([
      expect.stringContaining('fused-text'),
    ])
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
