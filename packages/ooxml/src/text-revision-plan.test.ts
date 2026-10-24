import { applyRunTextReplacementRange } from './model-run-range-edits'
import { expect, it } from 'bun:test'
import { createTrackedEditWriter } from './tracked-edits'
import JSZip from 'jszip'
import { planTextRevision } from '@obiter/contracts'
import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  parseDocx,
  parseModelJson,
  serialiseDocx,
} from './index'

it('exposes source eligibility and plans exactly the text the tracked writer persists', async () => {
  const cases = [
    {
      children: '<w:t>a</w:t><w:tab/><w:t>b</w:t>',
      next: 'x',
      eligible: false,
      removed: 'a\tb',
      inserted: 'x\t',
      pendingProperties: false,
    },
    {
      children: '<w:t>Order 60,000 units</w:t>',
      next: 'Order 45,000 units',
      eligible: true,
      removed: 'Order 60,000 units',
      inserted: 'Order 45,000 units',
      pendingProperties: true,
    },
    {
      children: '<w:t>cat</w:t>',
      next: 'cat\r\ndog',
      eligible: true,
      removed: '',
      inserted: '\ndog',
    },
    {
      children: '<w:t>cat</w:t><w:tab/>',
      next: 'dog\rearth',
      eligible: false,
      removed: 'cat\t',
      inserted: 'dog\nearth\t',
    },
    {
      children: '<w:t>Order 60,000 units</w:t>',
      next: 'Order 45,000 units',
      eligible: true,
      removed: '60,000',
      inserted: '45,000',
    },
    {
      children: '<w:rPr><w:b/></w:rPr><w:t>the cat sat</w:t>',
      next: 'the cats sat',
      eligible: true,
      removed: '',
      inserted: 's',
    },
    {
      children: '<w:t>hello</w:t><w:br/><w:t>world</w:t>',
      next: 'hello\nearth',
      eligible: false,
      removed: 'hello\nworld',
      inserted: 'hello\nearth',
    },
    {
      children: '<w:t>cat</w:t><w:tab/>',
      next: 'dog',
      eligible: false,
      removed: 'cat\t',
      inserted: 'dog\t',
    },
    {
      children: '<w:t>cat</w:t><w:rPr><w:b/></w:rPr>',
      next: 'dog',
      eligible: false,
      removed: 'cat',
      inserted: 'dog',
    },
    {
      children: '<w:t>😀</w:t>',
      next: '😃',
      eligible: true,
      removed: '😀',
      inserted: '😃',
    },
  ]
  const mappings = [
    [0, 0, 'x', [{ offset: 1, text: '\t' }]],
    [0, 0, 'Order 45,000 units', []],
    [3, 0, '\ndog', []],
    [0, 0, 'dog\nearth', [{ offset: 9, text: '\t' }]],
    [6, 6, '45,000', []],
    [7, 4, 's', []],
    [0, 0, 'hello\nearth', []],
    [0, 0, 'dog', [{ offset: 3, text: '\t' }]],
    [0, 0, 'dog', []],
    [0, 0, '😃', []],
  ]
  for (const [index, item] of cases.entries()) {
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>${item.children}</w:r></w:p></w:body></w:document>`,
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Missing fixture run')
    expect(run.textRevisionEligible).toBe(item.eligible)
    const plan = planTextRevision(
      run.text,
      item.next,
      run.textRevisionEligible === true,
      run.textRevisionTokens,
      item.pendingProperties ?? false,
      run.textRevisionTextRanges?.length,
    )
    expect([plan.removed, plan.inserted]).toEqual([item.removed, item.inserted])
    expect([
      plan.prefixLength,
      plan.suffixLength,
      plan.editableInserted,
      plan.retained,
    ]).toEqual(mappings[index])
    const cached = structuredClone(document.model)
    const cachedRun = cached.stories[0]?.paragraphs[0]?.runs[0]
    if (!cachedRun) throw new Error('Missing cached run')
    delete cachedRun.textRevisionEligible
    expect(() => parseModelJson(JSON.stringify(cached))).toThrow()
    applyDocumentEdits(
      document,
      [
        ...(item.pendingProperties
          ? [{ type: 'set_run_style' as const, runId: run.id, styleId: null }]
          : []),
        { type: 'replace_run_text' as const, runId: run.id, text: item.next },
      ],
      { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
    )
    const saved = await parseDocx(await serialiseDocx(document))
    expect(
      saved.model.changes
        .filter((change) => change.text)
        .map((change) => [change.kind, change.text]),
    ).toEqual([
      ...(item.removed ? [['delete', item.removed]] : []),
      ...(item.inserted ? [['insert', item.inserted]] : []),
    ])
  }
})

it('does not advertise granular edits for runs with stored property revisions', async () => {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rPrChange w:id="7" w:author="Synthetic Reviewer"><w:rPr/></w:rPrChange></w:rPr><w:t>Order 60,000 units</w:t></w:r></w:p></w:body></w:document>',
  )
  const document = await parseDocx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
  if (!run) throw new Error('Missing fixture run')
  expect(run.textRevisionEligible).toBe(false)
  expect(() =>
    applyDocumentEdits(
      document,
      [{ type: 'replace_run_text', runId: run.id, text: 'Order 45,000 units' }],
      { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
    ),
  ).toThrow()
})

it('keeps split run revision text local after inserting a footnote', async () => {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>cat</w:t><w:tab/><w:t>dog</w:t></w:r></w:p></w:body></w:document>',
  )
  const document = await parseDocx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  const paragraph = document.model.stories[0]?.paragraphs[0]
  if (!paragraph) throw new Error('Missing fixture paragraph')
  applyDocumentEdits(document, [
    {
      type: 'insert_footnote',
      paragraphId: paragraph.id,
      offset: 4,
      text: 'Synthetic note',
    },
  ])
  const plans = paragraph.runs
    .filter((run) => run.text)
    .map((run) =>
      planTextRevision(
        run.text,
        'x',
        run.textRevisionEligible === true,
        run.textRevisionTokens,
        false,
        run.textRevisionTextRanges?.length,
      ),
    )
  expect(plans.map((plan) => plan.removed)).toEqual(['cat\td', 'og'])
})

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

it('preserves the unchanged space after a CRLF source when saving a tracked substitution', async () => {
  const { document, run } = await revisionFixture('<w:t>a&#13;&#10;b c</w:t>')
  applyDocumentEdits(
    document,
    [{ type: 'replace_run_text', runId: run.id, text: 'a\r\nb d' }],
    { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
  )
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories[0]?.paragraphs[0]?.runs.map((run) => run.text).join(''),
  ).toBe('a\r\nb ')
  expect(
    saved.model.changes.map((change) => [change.kind, change.text]),
  ).toEqual([
    ['delete', 'c'],
    ['insert', 'd'],
  ])
})

it('keeps retained tabs after their source text when CRLF is normalised', async () => {
  const { document, run } = await revisionFixture(
    '<w:t>a&#13;&#10;b</w:t><w:tab/><w:t>c</w:t>',
  )
  const plan = planTextRevision(
    run.text,
    'x',
    false,
    run.textRevisionTokens,
    false,
    run.textRevisionTextRanges?.length,
  )
  expect(plan.removed).toBe('a\nb\tc')
  applyDocumentEdits(
    document,
    [{ type: 'replace_run_text', runId: run.id, text: 'x' }],
    { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
  )
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.changes.map((change) => [change.kind, change.text]),
  ).toEqual([
    ['delete', 'a\r\nb\tc'],
    ['insert', plan.inserted],
  ])
})

it('assigns a tab at an emphasis cut to the piece containing its XML', async () => {
  const { document, paragraph } = await revisionFixture(
    '<w:t>cat</w:t><w:tab/><w:t>dog</w:t>',
  )
  applyDocumentEdits(
    document,
    [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 3,
        to: 6,
        bold: true,
      },
    ],
    { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
  )
  const removed = paragraph.runs.map(
    (run) =>
      planTextRevision(
        run.text,
        'x',
        run.textRevisionEligible === true,
        run.textRevisionTokens,
        false,
        run.textRevisionTextRanges?.length,
      ).removed,
  )
  expect(removed).toEqual(['cat', '\tdog'])
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories[0]?.paragraphs[0]?.runs.map(
      (run) =>
        planTextRevision(
          run.text,
          'x',
          run.textRevisionEligible === true,
          run.textRevisionTokens,
          false,
          run.textRevisionTextRanges?.length,
        ).removed,
    ),
  ).toEqual(removed)
})

it('keeps source coordinates after a line-ending-only tracked no-op before a footnote', async () => {
  const { document, paragraph, run } =
    await revisionFixture('<w:t>a&#10;b</w:t>')
  const anchor = document.textRunAnchors.get(run.id)
  if (!anchor) throw new Error('Missing anchor')
  createTrackedEditWriter(document, {
    author: 'Synthetic Reviewer',
    date: '2026-10-24T12:00:00.000Z',
  }).replaceRunText(anchor, 'a\r\nb')
  applyDocumentEdits(document, [
    {
      type: 'insert_footnote',
      paragraphId: paragraph.id,
      offset: 2,
      text: 'Synthetic note',
    },
  ])
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories[0]?.paragraphs[0]?.runs.map((run) => run.text).join(''),
  ).toBe('a\nb')
})

it('uses the same source walk for editable text, breaks and retained controls', async () => {
  const { run } = await revisionFixture(
    '<w:t>a</w:t><w:smartTag><w:br/></w:smartTag><w:del w:id="9" w:author="Synthetic"><w:r><w:delText>hidden</w:delText><w:tab/></w:r></w:del><w:t>b</w:t><w:tab/>',
  )
  expect(run.text).toBe('a\nb')
  expect(
    planTextRevision(
      run.text,
      'x',
      false,
      run.textRevisionTokens,
      false,
      run.textRevisionTextRanges?.length,
    ).removed,
  ).toBe('a\nb\t')
})

it('keeps whole-run property revisions ineligible across a subsequent split', async () => {
  const { document, paragraph, run } =
    await revisionFixture('<w:t>cat dog</w:t>')
  const anchor = document.textRunAnchors.get(run.id)
  if (!anchor) throw new Error('Missing anchor')
  createTrackedEditWriter(document, {
    author: 'Synthetic Reviewer',
    date: '2026-10-24T12:00:00.000Z',
  }).setRunStyle(anchor, null)
  expect(() => parseModelJson(JSON.stringify(document.model))).not.toThrow()
  applyDocumentEdits(document, [
    {
      type: 'insert_footnote',
      paragraphId: paragraph.id,
      offset: 4,
      text: 'Synthetic note',
    },
  ])
  expect(
    paragraph.runs
      .filter((run) => run.text)
      .map(
        (run) =>
          planTextRevision(
            run.text,
            'x',
            run.textRevisionEligible === true,
            run.textRevisionTokens,
          ).removed,
      ),
  ).toEqual(['cat ', 'dog'])
  expect(
    paragraph.runs
      .filter((run) => run.text)
      .map(
        (run) =>
          planTextRevision(
            run.text,
            'cats ',
            run.textRevisionEligible === true,
            run.textRevisionTokens,
          ).kind,
      ),
  ).toEqual(['whole-run', 'whole-run'])
})

it('plans multiline range replacement pieces from their emitted text elements', async () => {
  const { document, paragraph } = await revisionFixture('<w:t>axz</w:t>')
  const anchor = document.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('Missing anchor')
  applyRunTextReplacementRange(document, anchor, [
    { from: 1, to: 2, text: 'one\ntwo' },
  ])
  const piece = paragraph.runs[1]
  if (!piece) throw new Error('Missing replacement')
  const plan = planTextRevision(
    piece.text,
    'red\nblue',
    piece.textRevisionEligible === true,
    piece.textRevisionTokens,
    false,
    piece.textRevisionTextRanges?.length,
  )
  expect(plan.inserted).toBe('red\nblue')
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories[0]?.paragraphs[0]?.runs[1]?.textRevisionTextRanges,
  ).toEqual(piece.textRevisionTextRanges)
})

it('keeps retained controls beside an untouched range-edit piece at the cut', async () => {
  const { document, paragraph } = await revisionFixture(
    '<w:t>cat</w:t><w:tab/><w:t>dog</w:t>',
  )
  const anchor = document.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('Missing anchor')
  applyRunTextReplacementRange(document, anchor, [
    { from: 0, to: 3, text: 'fox' },
  ])
  expect(
    paragraph.runs.map(
      (run) =>
        planTextRevision(
          run.text,
          '?',
          run.textRevisionEligible === true,
          run.textRevisionTokens,
        ).removed,
    ),
  ).toEqual(['fox', '\tdog'])
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories[0]?.paragraphs[0]?.runs.map(
      (run) =>
        planTextRevision(
          run.text,
          '?',
          run.textRevisionEligible === true,
          run.textRevisionTokens,
        ).removed,
    ),
  ).toEqual(['fox', '\tdog'])
})

for (const control of ['<w:tab/>', '<w:fldChar w:fldCharType="begin"/>']) {
  it(`preserves ${control} at the start of redacted text`, async () => {
    const { document, paragraph } = await revisionFixture(
      `<w:t>cat</w:t>${control}<w:t>dog</w:t>`,
    )
    const anchor = document.paragraphAnchors.get(paragraph.id)
    if (!anchor) throw new Error('Missing anchor')
    applyRunTextReplacementRange(document, anchor, [
      { from: 3, to: 6, text: 'XXX' },
    ])
    const bytes = await serialiseDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')?.async('string')
    expect(xml).toContain(`<w:t>cat</w:t>${control}</w:r>`)
    expect(xml?.split(control)).toHaveLength(2)
    const saved = await parseDocx(bytes)
    expect(
      saved.model.stories[0]?.paragraphs[0]?.runs.map((run) => run.text),
    ).toEqual(['cat', 'XXX'])
    expect(paragraph.runs[0]?.textRevisionTokens).toEqual(
      saved.model.stories[0]?.paragraphs[0]?.runs[0]?.textRevisionTokens,
    )
  })
}

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
