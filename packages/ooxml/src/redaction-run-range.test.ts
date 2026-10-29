import { expect, it } from 'bun:test'
import JSZip from 'jszip'
import { planTextRevision } from '@obiter/contracts'
import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'
import { applyRunTextReplacementRange } from './model-run-range-edits'

async function revisionFixture(children: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>${children}</w:r></w:p></w:body></w:document>`,
  )
  const document = await parseDocx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  const paragraph = document.model.stories[0]?.paragraphs[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Missing fixture')
  return { document, paragraph, run }
}

const begin = '<w:fldChar w:fldCharType="begin"/>'
const end = '<w:fldChar w:fldCharType="end"/>'
const tab = '<w:tab/>'
const italic = '<w:rPr><w:i/></w:rPr>'
const piece = (inner: string) => `<w:r>${inner}</w:r>`
const text = (value: string) =>
  `<w:t${/^\s|\s$/u.test(value) ? ' xml:space="preserve"' : ''}>${value}</w:t>`
for (const [children, ranges, runs] of [
  [
    `${text('cat')}${tab}${text('dog')}`,
    [[3, 6]],
    [`${text('cat')}${tab}`, text('XXX')],
  ],
  [
    `${text('cat')}${begin}${text('dog')}`,
    [[3, 6]],
    [`${text('cat')}${begin}`, text('XXX')],
  ],
  [
    `${text('cat')}${end}${text('dog')}`,
    [[0, 3]],
    [text('XXX'), `${end}${text('dog')}`],
  ],
  [
    `${text('cat')}${tab}${text('dog')}`,
    [[0, 3]],
    [text('XXX'), `${tab}${text('dog')}`],
  ],
  [
    `${text('cat')}${tab}${text('dog')}`,
    [
      [1, 3],
      [3, 5],
    ],
    [
      text('c'),
      `${text('XX')}${tab}`,
      text('Y'),
      '<w:t xml:space="preserve">g</w:t>',
    ],
  ],
  [
    `${tab}${text('catdog')}`,
    [[0, 3]],
    [`${tab}${text('XXX')}`, '<w:t xml:space="preserve">dog</w:t>'],
  ],
  [
    `${italic}${tab}${text('catdog')}`,
    [[0, 3]],
    [
      `${italic}${tab}${text('XXX')}`,
      `${italic}<w:t xml:space="preserve">dog</w:t>`,
    ],
  ],
  [
    `${begin}${text('catdog')}`,
    [[0, 3]],
    [text('XXX'), '<w:t xml:space="preserve">dog</w:t>'],
  ],
  [`${text('catdog')}${end}`, [[3, 6]], [text('cat'), text('XXX')]],
  [
    `${text('cat')}${tab}${text('dog')}`,
    [[2, 4]],
    [text('ca'), `${text('XX')}${tab}`, '<w:t xml:space="preserve">og</w:t>'],
  ],
] as const) {
  it(`keeps controls in ${children} when redacting ${JSON.stringify(ranges)}`, async () => {
    const { document, paragraph } = await revisionFixture(children)
    const anchor = document.paragraphAnchors.get(paragraph.id)
    if (!anchor) throw new Error('Missing anchor')
    applyRunTextReplacementRange(
      document,
      anchor,
      ranges.map(([from, to], index) => ({
        from,
        to,
        text: index === 1 ? 'Y' : 'X'.repeat(to - from),
      })),
    )
    const bytes = await serialiseDocx(document)
    const xml = await (
      await JSZip.loadAsync(bytes)
    )
      .file('word/document.xml')
      ?.async('string')
    expect(xml).toContain(`<w:p>${runs.map(piece).join('')}</w:p>`)
    const saved = (await parseDocx(bytes)).model.stories[0]?.paragraphs[0]
    const metadata = (runs: typeof paragraph.runs) =>
      runs.map((run) => {
        const plan = planTextRevision(
          run.text,
          '?',
          run.textRevisionEligible === true,
          run.textRevisionTokens,
          false,
          run.textRevisionTextRanges?.length,
        )
        return /^[XY]+$/u.test(run.text)
          ? [
              run.textRevisionEligible,
              run.textRevisionTokens,
              run.textRevisionTextRanges,
            ]
          : [plan.removed, plan.inserted]
      })
    expect(metadata(paragraph.runs)).toEqual(metadata(saved?.runs ?? []))
  })
}

it('keeps tabs in a styled whole-run redaction with a multiline marker', async () => {
  const { document, paragraph } = await revisionFixture(
    `${begin}<w:t>cat</w:t><w:tab/><w:t>dog</w:t>${end}`,
  )
  const anchor = document.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('Missing anchor')
  applyRunTextReplacementRange(document, anchor, [
    { from: 0, to: 6, text: 'X\nY', emphasis: { bold: true } },
  ])
  const bytes = await serialiseDocx(document)
  const xml = await (
    await JSZip.loadAsync(bytes)
  )
    .file('word/document.xml')
    ?.async('string')
  expect(xml).toContain('<w:t>X</w:t><w:br/><w:t>Y</w:t><w:tab/></w:r>')
  const saved = (await parseDocx(bytes)).model.stories[0]?.paragraphs[0]?.runs
  expect(paragraph.runs.map((run) => run.textRevisionTokens)).toEqual(
    saved?.map((run) => run.textRevisionTokens) ?? [],
  )
  expect(paragraph.runs.map((run) => run.textRevisionTextRanges)).toEqual(
    saved?.map((run) => run.textRevisionTextRanges) ?? [],
  )
})

it('drops drawings and field instructions inside partial and whole-run redactions', async () => {
  for (const [from, to] of [
    [1, 5],
    [0, 6],
  ]) {
    const { document, paragraph } = await revisionFixture(
      '<w:t>cat</w:t><w:drawing><w:docPr descr="private image"/></w:drawing><w:instrText>PRIVATE FIELD</w:instrText><w:footnoteReference w:id="1"/><w:sym w:char="0041"/><w:t>dog</w:t>',
    )
    const anchor = document.paragraphAnchors.get(paragraph.id)
    if (!anchor || from === undefined || to === undefined)
      throw new Error('Missing fixture')
    applyRunTextReplacementRange(document, anchor, [{ from, to, text: 'XXX' }])
    const bytes = await serialiseDocx(document)
    const xml = await (
      await JSZip.loadAsync(bytes)
    )
      .file('word/document.xml')
      ?.async('string')
    expect(xml).toContain('XXX')
    for (const payload of [
      'drawing',
      'instrText',
      'footnoteReference',
      'sym',
      'PRIVATE FIELD',
      'private image',
    ]) {
      expect(xml).not.toContain(payload)
    }
    expect(
      (await parseDocx(bytes)).model.stories[0]?.paragraphs[0]?.runs
        .map((run) => run.text)
        .join(''),
    ).toBe(from === 0 ? 'XXX' : 'cXXXg')
  }
})

for (const encoded of ['&#13;', '&#13;&#10;']) {
  it(`preserves source ${encoded} in tracked prefixes, suffixes and deletions`, async () => {
    for (const [children, next, expected] of [
      [
        `<w:t>a${encoded}b c</w:t>`,
        'a\nb d',
        `<w:t xml:space="preserve">a${encoded}b </w:t>`,
      ],
      [
        `<w:t>c a${encoded}b</w:t>`,
        'd a\nb',
        `<w:t xml:space="preserve"> a${encoded}b</w:t>`,
      ],
      [
        `<w:t>a${encoded}b c</w:t>`,
        ' c',
        `<w:delText>a${encoded}b</w:delText>`,
      ],
      [
        `<w:t>a${encoded}b</w:t><w:tab/>`,
        'x',
        `<w:delText>a${encoded}b</w:delText>`,
      ],
    ]) {
      const { document, run } = await revisionFixture(children)
      applyDocumentEdits(
        document,
        [{ type: 'replace_run_text', runId: run.id, text: next }],
        { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
      )
      const zip = await JSZip.loadAsync(await serialiseDocx(document))
      expect(await zip.file('word/document.xml')?.async('string')).toContain(
        expected,
      )
    }
  })
}

it('keeps a range replacement with duplicate run properties ineligible', async () => {
  const { document, paragraph } = await revisionFixture(
    '<w:rPr/><w:rPr/><w:t>cat dog</w:t>',
  )
  const anchor = document.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('Missing anchor')
  applyRunTextReplacementRange(document, anchor, [
    { from: 0, to: 3, text: 'fox' },
  ])
  expect(paragraph.runs[0]?.textRevisionEligible).toBe(false)
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories[0]?.paragraphs[0]?.runs[0]?.textRevisionEligible,
  ).toBe(false)
})
