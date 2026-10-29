import { describe, expect, it } from 'bun:test'
import {
  extractLegalDocMlJudges,
  extractLegalDocMlMetadata,
  extractLegalDocMlPressSummary,
  parseLegalDocMlParagraphs,
} from './legaldocml-parser'

function judgment(body: string, header = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0">
  <judgment name="judgment">
    <meta>
      <identification source="#tna">
        <FRBRWork>
          <FRBRdate date="2019-05-02" name="judgment"/>
          <FRBRname value="Alpha Ltd v Beta Ltd"/>
        </FRBRWork>
      </identification>
    </meta>
    <header>
      <p>Neutral Citation Number: [2019] EWHC 1094 (IPEC)</p>
      <p>IP-2017-000196</p>
      <p>Royal Courts of Justice, Rolls Building, London</p>
      ${header}
    </header>
    <judgmentBody>
      <decision>
${body}
      </decision>
    </judgmentBody>
  </judgment>
</akomaNtoso>`
}

const paragraph = (eId: string, num: string, text: string) => `
        <paragraph eId="${eId}">
          <num>${num}</num>
          <content><p>${text}</p></content>
        </paragraph>`

const level = (text: string) => `
        <level>
          <content><p>${text}</p></content>
        </level>`

describe('parseLegalDocMlParagraphs', () => {
  it('reads the judgment body and ignores the cover sheet', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph('para_1', '1.', 'The claimant runs the awards.') +
          paragraph('para_2', '2.', 'The defendant adopted a similar name.'),
      ),
      'ewhc-ipec-2019-1094',
    )

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs?.[0]?.text).toBe('The claimant runs the awards.')
    expect(JSON.stringify(paragraphs)).not.toContain('IP-2017-000196')
    expect(JSON.stringify(paragraphs)).not.toContain('Royal Courts of Justice')
  })

  it('numbers paragraphs the way the court numbered them', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph('para_1', '1.', 'First.') +
          paragraph('para_2', '2.', 'Second.'),
      ),
      'doc',
    )

    expect(paragraphs?.map((p) => p.paragraphNumber)).toEqual([1, 2])
    expect(paragraphs?.map((p) => p.id)).toEqual(['doc-p1', 'doc-p2'])
  })

  it('keeps the paragraph number out of the paragraph text', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(paragraph('para_1', '1.', 'The appeal is allowed.')),
      'doc',
    )

    expect(paragraphs?.[0]?.text).toBe('The appeal is allowed.')
  })

  it('reads a number that carries decoration', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(paragraph('para_106', '§106.', 'Text.')),
      'doc',
    )

    expect(paragraphs?.[0]?.paragraphNumber).toBe(106)
  })

  it('allows repeated numbers across separate opinions', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph('para_1', '1.', 'Majority opinion.') +
          level('Lord Justice Second:') +
          paragraph('para_1b', '1.', 'Concurring opinion.'),
      ),
      'doc',
    )

    expect(paragraphs?.map((p) => p.paragraphNumber)).toEqual([1, 1])
    expect(new Set(paragraphs?.map((p) => p.id)).size).toBe(2)
  })

  it('keeps nested sub-items inside their paragraph', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(`
        <paragraph eId="para_1">
          <num>1.</num>
          <content><p>The conditions are:</p></content>
          <subparagraph><num>(a)</num><content><p>the first condition;</p></content></subparagraph>
          <subparagraph><num>(b)</num><content><p>the second condition.</p></content></subparagraph>
        </paragraph>`),
      'doc',
    )

    expect(paragraphs).toHaveLength(1)
    expect(paragraphs?.[0]?.paragraphNumber).toBe(1)
    expect(paragraphs?.[0]?.text).toContain('the first condition')
    expect(paragraphs?.[0]?.text).toContain('the second condition')
  })

  it('attaches unnumbered content to the paragraph that introduced it', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph('para_1', '1.', 'The court said this:') +
          level('Normal residence means the place where a person lives.') +
          paragraph('para_2', '2.', 'I respectfully agree.'),
      ),
      'doc',
    )

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs?.[0]?.text).toContain('Normal residence means')
    expect(paragraphs?.[1]?.text).toBe('I respectfully agree.')
  })

  it('drops the judge name and title that precede the first paragraph', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        level('MISS RECORDER AMANDA MICHAELS JUDGMENT Introduction') +
          paragraph('para_1', '1.', 'The claim is for passing off.'),
      ),
      'doc',
    )

    expect(paragraphs).toHaveLength(1)
    expect(paragraphs?.[0]?.text).toBe('The claim is for passing off.')
  })

  it('decodes character references in judgment text', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph(
          'para_1',
          '1.',
          'He said &#8220;the judge erred&#8221; &#8212; twice.',
        ),
      ),
      'doc',
    )

    expect(paragraphs?.[0]?.text).toBe('He said “the judge erred” — twice.')
  })

  it('collapses whitespace introduced by the markup', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(`
        <paragraph eId="para_1">
          <num>1.</num>
          <content>
            <p>One <span>two</span>   three</p>
          </content>
        </paragraph>`),
      'doc',
    )

    expect(paragraphs?.[0]?.text).toBe('One two three')
  })
})

describe('judgments grouped under levels', () => {
  it('reads paragraphs nested inside a level', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(`
        <level eId="lvl_1">
          <heading>Writing Credits</heading>
          ${paragraph('para_1', '1.', 'The first issue is authorship.')}
          ${paragraph('para_2', '2.', 'The second issue is credit.')}
        </level>`),
      'doc',
    )

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs?.map((p) => p.paragraphNumber)).toEqual([1, 2])
    expect(paragraphs?.[0]?.text).toBe('The first issue is authorship.')
  })

  it('keeps document order across mixed nesting', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph('para_1', '1.', 'Top level.') +
          `<level eId="lvl_1">${paragraph('para_2', '2.', 'Nested.')}</level>` +
          paragraph('para_3', '3.', 'Top level again.'),
      ),
      'doc',
    )

    expect(paragraphs?.map((p) => p.text)).toEqual([
      'Top level.',
      'Nested.',
      'Top level again.',
    ])
  })

  it('treats a level heading as unnumbered text', () => {
    const paragraphs = parseLegalDocMlParagraphs(
      judgment(
        paragraph('para_1', '1.', 'Introductory paragraph.') +
          `<level eId="lvl_1"><heading>The law</heading>${paragraph('para_2', '2.', 'The statute provides.')}</level>`,
      ),
      'doc',
    )

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs?.[0]?.text).toContain('The law')
    expect(paragraphs?.[1]?.text).toBe('The statute provides.')
  })
})

describe('falling back to HTML', () => {
  it('returns null when the document has no judgment body', () => {
    expect(
      parseLegalDocMlParagraphs('<akomaNtoso><judgment/></akomaNtoso>', 'doc'),
    ).toBeNull()
  })

  it('returns null when the body holds no paragraphs', () => {
    expect(
      parseLegalDocMlParagraphs(judgment(level('Heading only')), 'doc'),
    ).toBeNull()
  })

  it('returns null for content that is not LegalDocML', () => {
    expect(
      parseLegalDocMlParagraphs('<html><body>hi</body></html>', 'doc'),
    ).toBeNull()
  })
})

describe('extractLegalDocMlMetadata', () => {
  it('reads what the judgment states about itself', () => {
    const metadata = extractLegalDocMlMetadata(
      judgment(paragraph('para_1', '1.', 'Text.')),
    )

    expect(metadata.title).toBe('Alpha Ltd v Beta Ltd')
    expect(metadata.dateDecided).toBe('2019-05-02')
  })

  it('returns nulls rather than throwing on unusable input', () => {
    expect(extractLegalDocMlMetadata('not xml at all')).toEqual({
      title: null,
      dateDecided: null,
      neutralCitation: null,
    })
  })
})

const enrichedHeader = `
      <references source="#tna">
        <TLCPerson eId="judge-lord-reed-president" href="/judge-lord-reed-president" showAs="Lord Reed, President"/>
        <TLCPerson eId="judge-lord-briggs" href="/judge-lord-briggs" showAs="Lord Briggs"/>
      </references>
      <p class="JudgmentJudges"><span>before</span><br/><br/><judge refersTo="#judge-lord-reed-president">Lord Reed, President</judge><br/><judge refersTo="#judge-lord-briggs">Lord Briggs</judge><br/><judge refersTo="#judge-lord-stephens">Lord Stephens</judge><br/><judge refersTo="#judge-lady-rose">Lady Rose</judge><br/><judge refersTo="#judge-lord-snowden">Lord Snowden</judge></p>`

describe('extractLegalDocMlJudges', () => {
  it('reads the bench from the header judge elements', () => {
    expect(
      extractLegalDocMlJudges(
        judgment(paragraph('para_1', '1.', 'Text.'), enrichedHeader),
      ),
    ).toEqual([
      'Lord Reed, President',
      'Lord Briggs',
      'Lord Stephens',
      'Lady Rose',
      'Lord Snowden',
    ])
  })

  it('yields nothing when the bench is only cover prose', () => {
    const proseHeader = `
      <p style="text-align:center"><span style="font-weight:bold">Before</span>:</p>
      <p class="CoverMain" style="text-align:center">HUGO KEITH KC, SITTING AS A DEPUTY HIGH COURT JUDGE</p>`

    expect(
      extractLegalDocMlJudges(
        judgment(paragraph('para_1', '1.', 'Text.'), proseHeader),
      ),
    ).toEqual([])
  })

  it('returns an empty list rather than throwing on unusable input', () => {
    expect(extractLegalDocMlJudges('<html><body>hi</body></html>')).toEqual([])
  })
})

describe('extractLegalDocMlPressSummary', () => {
  const pressSummary = `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0" xmlns:uk="https://caselaw.nationalarchives.gov.uk/akn">
  <doc name="pressSummary">
    <meta>
      <proprietary source="#tna">
        <uk:summaryOf>https://caselaw.nationalarchives.gov.uk/id/uksc/2026/31</uk:summaryOf>
      </proprietary>
    </meta>
    <mainBody>
      <level>
        <content>
          <p class="Heading5"><span>Background to the Appeal</span></p>
        </content>
      </level>
      <level>
        <content>
          <p><span>This appeal concerns the operation of the regime in the Commonhold and Leasehold Reform Act 2002 (the &#8220;</span><span style="font-weight:bold">CLRA</span><span>&#8221;).</span></p>
        </content>
      </level>
    </mainBody>
  </doc>
</akomaNtoso>`

  it('reads the published paragraphs and the judgment it summarises', () => {
    const summary = extractLegalDocMlPressSummary(pressSummary)

    expect(summary?.summaryOf).toBe(
      'https://caselaw.nationalarchives.gov.uk/id/uksc/2026/31',
    )
    expect(summary?.paragraphs).toEqual([
      'Background to the Appeal',
      'This appeal concerns the operation of the regime in the Commonhold and Leasehold Reform Act 2002 (the “CLRA”).',
    ])
  })

  it('returns null for a document with no main body', () => {
    expect(
      extractLegalDocMlPressSummary(
        '<akomaNtoso><judgment><header/></judgment></akomaNtoso>',
      ),
    ).toBeNull()
  })
})
