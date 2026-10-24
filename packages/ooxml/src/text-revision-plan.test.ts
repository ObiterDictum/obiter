import { expect, it } from 'bun:test'
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
  const zip = await JSZip.loadAsync(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>${children}</w:r></w:p></w:body></w:document>`)
  const document = await parseDocx(await zip.generateAsync({ type: 'uint8array' }))
  const paragraph = document.model.stories[0]?.paragraphs[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Missing fixture')
  return { document, paragraph, run }
}

it('preserves the unchanged space after a CRLF source when saving a tracked substitution', async () => {
  const { document, run } = await revisionFixture('<w:t>a&#13;&#10;b c</w:t>')
  applyDocumentEdits(document, [{ type: 'replace_run_text', runId: run.id, text: 'a\r\nb d' }], { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' })
  const saved = await parseDocx(await serialiseDocx(document))
  expect(saved.model.stories[0]?.paragraphs[0]?.runs.map(run => run.text).join('')).toBe('a\nb ')
  expect(saved.model.changes.map(change => [change.kind, change.text])).toEqual([['delete', 'c'], ['insert', 'd']])
})
