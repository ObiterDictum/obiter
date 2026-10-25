import { expect, it } from 'bun:test'
import {
  createBlankDocx,
  parseDocx,
  serialiseDocx,
  applyDocumentEdits,
} from '@obiter/ooxml'
import { inlineChanges } from './document-inline-changes'
import { effectiveParagraph } from './document-model-text'
import {
  buildPendingRedlines,
  pendingParagraphChanges,
} from './document-pending-redlines'
import { emptyDraftState, planDocumentSave } from './document-save-plan'

async function fixture(body: string) {
  const document = await parseDocx(await createBlankDocx())
  const part = document.sourceParts.get('word/document.xml')
  if (!part) throw new Error('Missing document part')
  part.originalPayload = new TextEncoder().encode(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${body}</w:p><w:p><w:r><w:t>Anchor</w:t></w:r></w:p></w:body></w:document>`,
  )
  return parseDocx(await serialiseDocx(document))
}
const author = {
  author: 'Synthetic Reviewer',
  date: '2026-10-25T12:00:00.000Z',
}

it('paints pending replacements after stored revisions at the source run edge, matching Save and caret affinity', async () => {
  for (const [kind, source, next, expected, caret] of [
    [
      'ins',
      '<w:t xml:space="preserve"> tail end</w:t>',
      'tail end',
      'keep old tail end',
      9,
    ],
    ['ins', '<w:t>word rest</w:t>', 'ward rest', 'keep oldwordward rest', 12],
    ['del', '<w:t>word</w:t><w:tab/>', 'ward', 'keep oldword\tward\t', 13],
  ] as const) {
    const document = await fixture(
      `<w:r><w:t xml:space="preserve">keep </w:t></w:r><w:${kind} w:id="1"><w:r><w:${kind === 'del' ? 'delText' : 't'}>old</w:${kind === 'del' ? 'delText' : 't'}></w:r></w:${kind}><w:r>${source}</w:r>`,
    )
    const paragraph = document.model.stories[0]?.paragraphs[0]
    const run = paragraph?.runs[1]
    if (!paragraph || !run) throw new Error('Missing fixture run')
    const state = emptyDraftState()
    state.drafts[run.id] = next
    const pending = buildPendingRedlines(document.model, state)
    const projection = inlineChanges(
      effectiveParagraph(paragraph, state.drafts),
      document.model.changes,
      'word/document.xml',
      pendingParagraphChanges(pending, paragraph.id),
    )
    expect(projection.text).toBe(expected)
    expect(projection.toDisplay(5)).toBe(caret)
    expect(projection.toEditable(caret)).toBe(5)
    applyDocumentEdits(
      document,
      planDocumentSave(document.model, state).operations,
      author,
    )
    const saved = await parseDocx(await serialiseDocx(document))
    const savedParagraph = saved.model.stories[0]?.paragraphs[0]
    if (!savedParagraph) throw new Error('Missing saved paragraph')
    expect(
      inlineChanges(savedParagraph, saved.model.changes, 'word/document.xml')
        .text,
    ).toBe(expected)
  }
})

it('paints a pending paragraph deletion in saved run order with each run formatting', async () => {
  const document = await fixture(
    '<w:r/><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">one </w:t></w:r><w:del w:id="1"><w:r><w:delText xml:space="preserve">earlier </w:delText></w:r></w:del><w:r><w:rPr><w:i/></w:rPr><w:t>two</w:t></w:r>',
  )
  const paragraph = document.model.stories[0]?.paragraphs[0]
  if (!paragraph) throw new Error('Missing paragraph')
  const state = emptyDraftState()
  state.deletedParagraphIds = [paragraph.id]
  const pending = buildPendingRedlines(document.model, state)
  const projection = inlineChanges(
    paragraph,
    document.model.changes,
    'word/document.xml',
    pendingParagraphChanges(pending, paragraph.id),
  )
  expect(projection.text).toBe('one earlier two')
  expect(projection.editableText).toBe('')
  expect(
    projection.spans.map((span) => [span.change.text, span.pending === true]),
  ).toEqual([
    ['one ', true],
    ['earlier ', false],
    ['two', true],
  ])
  expect(
    projection.paragraph.runs
      .filter((run) => run.id.startsWith('pending:'))
      .map((run) => run.preservedXmlFragments),
  ).toEqual(
    paragraph.runs
      .filter((run) => run.text)
      .map((run) => run.preservedXmlFragments),
  )
  const empty = await fixture('<w:r/><w:r/>')
  const emptyParagraph = empty.model.stories[0]?.paragraphs[0]
  if (!emptyParagraph) throw new Error('Missing empty paragraph')
  const deleted = emptyDraftState()
  deleted.deletedParagraphIds = [emptyParagraph.id]
  const emptyProjection = inlineChanges(
    emptyParagraph,
    [],
    'word/document.xml',
    pendingParagraphChanges(
      buildPendingRedlines(empty.model, deleted),
      emptyParagraph.id,
    ),
  )
  expect(emptyProjection.text).toBe('¶')
  expect(emptyProjection.spans).toHaveLength(1)
})

it('holds back pending marks for a text edit the writer refuses on a run property revision', async () => {
  const document = await fixture(
    '<w:r><w:rPr><w:rPrChange w:id="1"><w:rPr/></w:rPrChange></w:rPr><w:t>old</w:t></w:r>',
  )
  const paragraph = document.model.stories[0]?.paragraphs[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Missing fixture run')
  const state = emptyDraftState()
  state.drafts[run.id] = 'new'
  expect(
    pendingParagraphChanges(
      buildPendingRedlines(document.model, state),
      paragraph.id,
    ),
  ).toEqual([])
  expect(() =>
    applyDocumentEdits(
      document,
      planDocumentSave(document.model, state).operations,
      author,
    ),
  ).toThrow()
})
