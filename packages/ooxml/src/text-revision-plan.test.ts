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
  for (const item of cases) {
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
      false,
      run.textRevisionTextRanges?.length,
    )
    expect([plan.removed, plan.inserted]).toEqual([item.removed, item.inserted])
    const cached = structuredClone(document.model)
    const cachedRun = cached.stories[0]?.paragraphs[0]?.runs[0]
    if (!cachedRun) throw new Error('Missing cached run')
    delete cachedRun.textRevisionEligible
    expect(() => parseModelJson(JSON.stringify(cached))).toThrow()
    applyDocumentEdits(
      document,
      [{ type: 'replace_run_text', runId: run.id, text: item.next }],
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
